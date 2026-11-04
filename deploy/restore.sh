#!/usr/bin/env bash
# Puts a backup made by backup.sh back into Warden's database (docs/deploy.md, "Restoring").
#
#   ./restore.sh /var/backups/warden/warden-20261104-021500.dump.enc
#
# It restores into a new, empty database first. Only when that worked does it swap the new one
# in, keeping the current database under another name, so a failed restore never loses data.
# The API is stopped while the two are swapped (about a minute for a pilot-sized database).
#
# Needs BACKUP_PASSPHRASE (deploy/.env or the environment) and, for the restored data to be
# readable, the same WARDEN_FIELD_KEY the server had when the backup was made.
set -euo pipefail

cd "$(dirname "$0")"

setting() {
  local name=$1 fallback=${2:-}
  if [ -n "${!name:-}" ]; then
    printf '%s' "${!name}"
    return
  fi
  if [ -f .env ]; then
    local line
    line=$(grep -E "^${name}=" .env | tail -n 1 || true)
    if [ -n "$line" ]; then
      local value=${line#*=}
      value=${value%\"}
      value=${value#\"}
      printf '%s' "$value"
      return
    fi
  fi
  printf '%s' "$fallback"
}

DB_NAME=${WARDEN_DB_NAME:-warden}
DB_USER=${WARDEN_DB_USER:-warden}
db_exec() {
  if [ -n "${WARDEN_DB_EXEC:-}" ]; then
    # shellcheck disable=SC2086 # the override is a command prefix, split on purpose
    ${WARDEN_DB_EXEC} "$@"
  else
    docker compose exec -T db "$@"
  fi
}
# The API is only stopped and started when running against the Docker setup.
api() {
  if [ -z "${WARDEN_DB_EXEC:-}" ]; then docker compose "$1" api; fi
}
sql() { db_exec psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -qtA -c "$1"; }

file=""
assume_yes=false
for arg in "$@"; do
  case "$arg" in
    --yes) assume_yes=true ;;
    -*) echo "Unknown option: $arg"; exit 1 ;;
    *) file=$arg ;;
  esac
done
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Usage: ./restore.sh <backup file> [--yes]"
  echo "Backups on this server, newest first:"
  shopt -s nullglob
  backups=("$(setting BACKUP_DIR /var/backups/warden)"/warden-*.dump.enc)
  for ((i = ${#backups[@]} - 1; i >= 0 && i >= ${#backups[@]} - 20; i--)); do
    echo "  ${backups[$i]}"
  done
  exit 1
fi

BACKUP_PASSPHRASE=$(setting BACKUP_PASSPHRASE)
if [ -z "$BACKUP_PASSPHRASE" ]; then
  echo "BACKUP_PASSPHRASE is not set (deploy/.env). It must be the one used for this backup."
  exit 1
fi
export BACKUP_PASSPHRASE

decrypt() {
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$file"
}

# 1. Check the file before touching anything.
if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256sum --check --quiet "$(basename "$file").sha256") || {
    echo "This backup file is damaged (its checksum does not match). Choose another one."
    exit 1
  }
fi
magic=$(decrypt 2>/dev/null | head -c 5 || true)
if [ "$magic" != "PGDMP" ]; then
  echo "This backup cannot be decrypted with the BACKUP_PASSPHRASE you gave, or is not a backup."
  exit 1
fi

stamp=$(date -u +%Y%m%d%H%M%S)
staging="${DB_NAME}_restoring"
kept="${DB_NAME}_before_restore_${stamp}"

exists=$(sql "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")
echo "This will replace the database \"$DB_NAME\" with the backup:"
echo "  $file"
if [ "$exists" = "1" ]; then
  echo "The current database is kept as \"$kept\" in case you need it back."
fi
echo "The API stops for about a minute; the moderator console and the app pause meanwhile."
if [ "$assume_yes" != true ]; then
  read -r -p "Type RESTORE to continue: " answer
  if [ "$answer" != "RESTORE" ]; then
    echo "Nothing was changed."
    exit 1
  fi
fi

# 2. Restore into a fresh database while the live one keeps running.
if [ "$(sql "SELECT 1 FROM pg_database WHERE datname = '$staging'")" = "1" ]; then
  db_exec dropdb -U "$DB_USER" "$staging"
fi
db_exec createdb -U "$DB_USER" -T template0 "$staging"
if ! decrypt | db_exec pg_restore -U "$DB_USER" -d "$staging" --no-owner --exit-on-error; then
  db_exec dropdb -U "$DB_USER" --if-exists "$staging"
  echo "The restore failed and was undone; the live database was not touched."
  exit 1
fi

# 3. Swap: stop the API, rename the live database out of the way, rename the restored one in.
api stop
if [ "$exists" = "1" ]; then
  sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()" >/dev/null
  sql "ALTER DATABASE \"$DB_NAME\" RENAME TO \"$kept\""
fi
sql "ALTER DATABASE \"$staging\" RENAME TO \"$DB_NAME\""
api start

echo "Restored. Check the console and the app."
if [ "$exists" = "1" ]; then
  echo "When you are sure all is well, delete the old copy to free space:"
  echo "  docker compose exec db dropdb -U $DB_USER $kept"
fi
