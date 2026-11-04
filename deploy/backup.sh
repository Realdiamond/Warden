#!/usr/bin/env bash
# Daily encrypted backup of Warden's database (docs/deploy.md, "Backups").
#
# Run it from cron on the server:
#   15 2 * * * /path/to/warden/deploy/backup.sh >> /var/log/warden-backup.log 2>&1
#
# Settings come from deploy/.env (or the environment, which wins):
#   BACKUP_PASSPHRASE      required; encrypts every backup. Keep a copy away from the server.
#   BACKUP_DIR             where backups are kept (default /var/backups/warden)
#   BACKUP_KEEP            how many backups to keep on the server (default 14)
#   BACKUP_RCLONE_REMOTE   optional offsite copy, for example "b2:warden-backups" (rclone)
#   BACKUP_REMOTE_KEEP_DAYS  days to keep offsite copies (default 30)
#
# The backup holds report text and exact locations only in their encrypted form; reading them
# after a restore still needs WARDEN_FIELD_KEY, which this script never copies.
set -euo pipefail

cd "$(dirname "$0")"

# Reads one setting from .env without running the file as a script (values may hold spaces).
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

# How the database is reached. On the server this is the "db" container; the WARDEN_DB_* and
# WARDEN_DB_EXEC overrides exist so the script can be tested against another PostgreSQL.
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

BACKUP_PASSPHRASE=$(setting BACKUP_PASSPHRASE)
BACKUP_DIR=$(setting BACKUP_DIR /var/backups/warden)
BACKUP_KEEP=$(setting BACKUP_KEEP 14)
BACKUP_RCLONE_REMOTE=$(setting BACKUP_RCLONE_REMOTE)
BACKUP_REMOTE_KEEP_DAYS=$(setting BACKUP_REMOTE_KEEP_DAYS 30)

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

if [ -z "$BACKUP_PASSPHRASE" ]; then
  log "ERROR: set BACKUP_PASSPHRASE in deploy/.env (openssl rand -base64 32)."
  exit 1
fi
if ! [[ "$BACKUP_KEEP" =~ ^[1-9][0-9]*$ ]]; then
  log "ERROR: BACKUP_KEEP must be a whole number of backups, like 14."
  exit 1
fi
export BACKUP_PASSPHRASE

umask 077
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%d-%H%M%S)
file="$BACKUP_DIR/warden-$stamp.dump.enc"
partial="$file.partial"
trap 'rm -f "$partial"' EXIT

# 1. Dump the whole database (PostgreSQL's own compressed format) and encrypt it as it streams,
#    so an unencrypted copy never touches the disk.
db_exec pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$partial"

# 2. Check it can be decrypted and is a real PostgreSQL dump ("PGDMP" is how one starts).
magic=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
  -in "$partial" 2>/dev/null | head -c 5 || true)
if [ "$magic" != "PGDMP" ]; then
  log "ERROR: the new backup could not be read back; it was not kept."
  exit 1
fi
mv "$partial" "$file"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
log "Backup written: $file ($(du -h "$file" | cut -f1))"

# 3. Keep only the newest BACKUP_KEEP backups on this server. Names carry the UTC time, so
#    alphabetical order is oldest first.
shopt -s nullglob
backups=("$BACKUP_DIR"/warden-*.dump.enc)
for ((i = 0; i < ${#backups[@]} - BACKUP_KEEP; i++)); do
  rm -f "${backups[$i]}" "${backups[$i]}.sha256"
  log "Removed old backup: ${backups[$i]}"
done

# 4. Optional copy away from the server, so a lost or broken server does not take the backups
#    with it.
if [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    log "ERROR: BACKUP_RCLONE_REMOTE is set but rclone is not installed (docs/deploy.md)."
    exit 1
  fi
  rclone copy "$file" "$BACKUP_RCLONE_REMOTE"
  rclone copy "$file.sha256" "$BACKUP_RCLONE_REMOTE"
  rclone delete "$BACKUP_RCLONE_REMOTE" --min-age "${BACKUP_REMOTE_KEEP_DAYS}d" \
    --include "warden-*.dump.enc" --include "warden-*.dump.enc.sha256"
  log "Copied offsite to $BACKUP_RCLONE_REMOTE (keeping $BACKUP_REMOTE_KEEP_DAYS days there)"
fi

log "Backup finished."
