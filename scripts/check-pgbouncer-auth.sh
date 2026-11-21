#!/usr/bin/env bash
set -euo pipefail

# Run inside the application container: Compose file secrets belong to its uid,
# which need not match the host runner's uid after runtime-permissions has run.
APP_PASSWORD="$(cat /run/secrets/db_password_server)"
ADMIN_PASSWORD="$(cat /run/secrets/postgres_password)"
APP_USER="${DB_USER_SERVER:-app_user}"

# Passwordless probes must not pick up ambient libpq credentials.
unset PGPASSWORD PGSERVICE PGSERVICEFILE
export PGPASSFILE=/dev/null PGCONNECT_TIMEOUT=10

pooler_psql() {
  local user="$1" password="$2"
  PGPASSWORD="$password" psql -X -w \
    -h "${PGBOUNCER_HOST:-pgbouncer}" -p "${PGBOUNCER_PORT:-6432}" \
    -U "$user" -d "${DB_NAME_SERVER:-server}" -tAc 'select current_user' 2>&1
}

expect_rejected() {
  local description="$1" output rc
  shift
  output="$(pooler_psql "$@")" && rc=0 || rc=$?
  if [ "$rc" -ne 0 ] && grep -qi 'no password supplied\|authentication failed\|no such user' <<<"$output"; then
    echo "ok   - rejected: $description"
  else
    echo "FAIL - expected an authentication failure for: $description (rc=$rc)"
    echo "$output"
    exit 1
  fi
}

for user in "$APP_USER" postgres; do
  expect_rejected "$user without a password" "$user" ""
  expect_rejected "$user with a wrong password" "$user" "not-the-password-$$"
done
# The superuser is not served through PgBouncer, even with its real secret.
expect_rejected "postgres with its real secret" postgres "$ADMIN_PASSWORD"

output="$(pooler_psql "$APP_USER" "$APP_PASSWORD")" || { echo "FAIL - $APP_USER could not log in through PgBouncer"; echo "$output"; exit 1; }
if [ "$output" != "$APP_USER" ]; then
  echo "FAIL - unexpected result for $APP_USER: $output"
  exit 1
fi
echo "ok   - $APP_USER authenticates with /run/secrets/db_password_server"
