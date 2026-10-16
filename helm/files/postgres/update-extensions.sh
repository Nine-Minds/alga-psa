#!/bin/sh
# Bring an existing bundled Postgres cluster in line with the image it now runs.
#
# Runs from the same image as the database (compose one-shot service
# `postgres-extension-update`, Helm Job `db-extension-update-<hash>`), so the
# local binary tells us which server version to wait for. Steps:
#   1. wait until the server reports the same version as the local binary
#   2. apply the CVE-2024-4317 catalog view fix where the check says it is needed
#      (every database, including template0 and template1)
#   3. ALTER EXTENSION ... UPDATE for every outdated extension in each database
#      that accepts connections
# Every step is a no-op on a fresh volume and on a re-run. Any failure exits
# non-zero.
#
# Environment:
#   PGHOST                           required
#   PGUSER                           default: postgres
#   PGPASSWORD / PGPASSWORD_FILE     password, or a file holding it
#   PGPORT                           default: 5432
#   UPDATE_EXTENSIONS_TIMEOUT_SECONDS  wait deadline, default: 900
set -eu

log() {
  printf '%s update-extensions: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

: "${PGHOST:?PGHOST is required}"
PGUSER="${PGUSER:-postgres}"
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}"
export PGHOST PGUSER PGCONNECT_TIMEOUT
if [ -n "${PGPASSWORD_FILE:-}" ]; then
  [ -r "$PGPASSWORD_FILE" ] || die "PGPASSWORD_FILE $PGPASSWORD_FILE is not readable"
  PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
fi
[ -n "${PGPASSWORD:-}" ] || die "set PGPASSWORD or PGPASSWORD_FILE"
export PGPASSWORD

# psql_db <database> [psql args...]: unaligned, tuples-only, fail on first error.
# The database goes through PGDATABASE so its name is never parsed as a conninfo string.
psql_db() {
  _db="$1"
  shift
  PGDATABASE="$_db" psql -X -q -A -t -v ON_ERROR_STOP=1 "$@"
}

TAB="$(printf '\t')"
changes=0
template0_open=0

close_template0() {
  psql_db postgres -c "ALTER DATABASE template0 WITH ALLOW_CONNECTIONS false"
  template0_open=0
}

# Always leave template0 closed, whatever happened while it was open.
on_exit() {
  _status=$?
  trap - EXIT
  if [ "$template0_open" -eq 1 ]; then
    log "closing template0 to connections again" >&2
    if ! close_template0; then
      log "ERROR: could not reset ALLOW_CONNECTIONS on template0; run: ALTER DATABASE template0 WITH ALLOW_CONNECTIONS false" >&2
      [ "$_status" -ne 0 ] || _status=1
    fi
  fi
  exit "$_status"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# --- 1. wait for the server that runs the same binary as this script ---------
expected="$(postgres --version)" || die "cannot read the local postgres version"
expected="${expected#postgres (PostgreSQL) }"
[ -n "$expected" ] || die "empty local postgres version"
timeout="${UPDATE_EXTENSIONS_TIMEOUT_SECONDS:-900}"
deadline=$(($(date +%s) + timeout))
log "waiting for $PGHOST to report server_version '$expected'"
while :; do
  if actual="$(psql_db postgres -c 'SHOW server_version' 2>&1)"; then
    [ "$actual" = "$expected" ] && break
    last="server_version is '$actual'"
  else
    case "$actual" in
      *"authentication failed"* | *"no pg_hba.conf entry"* | *"does not exist"*)
        die "cannot log in to $PGHOST as $PGUSER: $actual"
        ;;
    esac
    last="$actual"
  fi
  [ "$(date +%s)" -lt "$deadline" ] || die "timed out after ${timeout}s waiting for server_version '$expected' on $PGHOST (last: $last)"
  sleep 2
done
log "server_version is $actual"

# --- 2. catalog view fix ------------------------------------------------------
fix_sql="$(pg_config --sharedir)/fix-CVE-2024-4317.sql"

# Prints t when the catalog views in <database> already carry the fix.
view_fix_present() {
  psql_db "$1" -c "SELECT pg_get_viewdef('pg_catalog.pg_stats_ext_exprs'::regclass) LIKE '%row_security_active%'"
}

apply_view_fix() {
  _db="$1"
  _present="$(view_fix_present "$_db")" || die "cannot check catalog views in $_db"
  case "$_present" in
    t) ;;
    f)
      [ -r "$fix_sql" ] || die "$fix_sql not found"
      log "[$_db] applying CVE-2024-4317 catalog view fix"
      psql_db "$_db" -f "$fix_sql" >/dev/null || die "CVE-2024-4317 fix failed in $_db"
      [ "$(view_fix_present "$_db")" = t ] || die "catalog views in $_db still lack the fix after applying it"
      changes=$((changes + 1))
      ;;
    *) die "unexpected catalog view check result '$_present' in $_db" ;;
  esac
}

databases="$(psql_db postgres -F "$TAB" -c 'SELECT datname, datallowconn FROM pg_database ORDER BY datname')" || die "cannot list databases"
while IFS="$TAB" read -r db allow; do
  [ -n "$db" ] || continue
  if [ "$db" = template0 ]; then
    # template0 normally refuses connections. Open it only for the duration of the
    # check (and fix); on_exit closes it again even when this script fails midway.
    if [ "$allow" = t ]; then
      log "WARNING: template0 accepts connections (left open by an interrupted run?); closing it after the check"
      changes=$((changes + 1))
    fi
    template0_open=1
    psql_db postgres -c "ALTER DATABASE template0 WITH ALLOW_CONNECTIONS true" || die "cannot open template0 for the check"
    apply_view_fix template0
    close_template0 || die "cannot close template0 again"
  elif [ "$allow" = t ]; then
    apply_view_fix "$db"
  else
    log "WARNING: [$db] does not accept connections; its catalog views were not checked"
  fi
done <<EOF_DATABASES
$databases
EOF_DATABASES

# --- 3. extension updates -----------------------------------------------------
connectable="$(psql_db postgres -c 'SELECT datname FROM pg_database WHERE datallowconn ORDER BY datname')" \
  || die "cannot list connectable databases"
while IFS= read -r db; do
  [ -n "$db" ] || continue
  outdated="$(psql_db "$db" -F "$TAB" -c \
    "SELECT name, installed_version, default_version FROM pg_available_extensions WHERE installed_version IS NOT NULL AND installed_version <> default_version ORDER BY name")" \
    || die "cannot list outdated extensions in $db"
  while IFS="$TAB" read -r name from to; do
    [ -n "$name" ] || continue
    printf 'ALTER EXTENSION :"ext" UPDATE;\n' | psql_db "$db" -v ext="$name" -f - >/dev/null \
      || die "ALTER EXTENSION $name UPDATE failed in $db"
    now="$(printf "SELECT extversion FROM pg_extension WHERE extname = :'ext';\\n" | psql_db "$db" -v ext="$name" -f -)" \
      || die "cannot read the new version of $name in $db"
    [ "$now" = "$to" ] || die "$name in $db is at $now after the update, expected $to"
    log "[$db] $name $from -> $to"
    changes=$((changes + 1))
  done <<EOF_OUTDATED
$outdated
EOF_OUTDATED
done <<EOF_CONNECTABLE
$connectable
EOF_CONNECTABLE

if [ "$changes" -eq 0 ]; then
  log "nothing to do"
else
  log "done ($changes change(s))"
fi
