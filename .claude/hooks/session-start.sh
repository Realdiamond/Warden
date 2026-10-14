#!/bin/bash
# Prepares a Claude Code cloud session: dependencies, PostgreSQL 16 + PostGIS, and the
# dev/test databases the API tests use. Safe to run more than once.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# 1. JavaScript dependencies (flat node_modules, see .npmrc).
pnpm install

# 2. PostGIS for the local PostgreSQL 16, only if it is missing.
if [ ! -f /usr/share/postgresql/16/extension/postgis.control ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -qq postgresql-16-postgis-3 >/dev/null 2>&1 || {
    apt-get update -qq >/dev/null
    apt-get install -y -qq postgresql-16-postgis-3 >/dev/null
  }
fi

# 3. Start PostgreSQL if it is not running.
if ! pg_lsclusters --no-header 2>/dev/null | grep -q "16 *main .*online"; then
  pg_ctlcluster 16 main start
fi

# 4. Role and databases used by apps/api (development-only credentials).
psql_admin() { su postgres -c "psql -v ON_ERROR_STOP=1 -qtA $*"; }
if [ "$(psql_admin "-c \"SELECT 1 FROM pg_roles WHERE rolname = 'warden'\"")" != "1" ]; then
  psql_admin "-c \"CREATE ROLE warden LOGIN PASSWORD 'warden_dev'\""
fi
for db in warden_dev warden_test; do
  if [ "$(psql_admin "-c \"SELECT 1 FROM pg_database WHERE datname = '$db'\"")" != "1" ]; then
    su postgres -c "createdb -O warden $db"
  fi
  psql_admin "-d $db -c \"CREATE EXTENSION IF NOT EXISTS postgis\""
done

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export TEST_DATABASE_URL="postgres://warden:warden_dev@localhost:5432/warden_test"' >> "$CLAUDE_ENV_FILE"
fi

echo "Warden session ready: dependencies installed, PostgreSQL + PostGIS running."
