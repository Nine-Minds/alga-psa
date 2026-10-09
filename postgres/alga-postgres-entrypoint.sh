#!/bin/bash
#
# Wrapper around the stock postgres image entrypoint (docker-entrypoint.sh).
#
# Postgres in this stack must only accept network connections that present a
# password. Data directories created by older releases may still carry
# legacy `trust` entries in pg_hba.conf. Before the server is allowed to
# listen, this wrapper:
#
#   * refuses POSTGRES_HOST_AUTH_METHOD=trust,
#   * detects legacy trust rules (field-aware, see HBA_AWK below),
#   * syncs the superuser password to the configured secret using a
#     socket-only maintenance server, so the switch cannot lock the stack out,
#   * rewrites trust rules to md5 (keeping a backup of the original file),
#   * fails closed (non-zero exit, no server) if anything goes wrong.
#
# On fresh installs and on already-repaired data directories it is a single
# awk pass followed by `exec` of the stock entrypoint with unchanged arguments.

set -Eeuo pipefail

BACKUP_NAME="pg_hba.conf.pre-trust-removal"
DOCS_HINT="See the 'Postgres authentication' section of docs/getting-started/setup_guide.md."

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] alga-postgres: $1"
}

die() {
    log "ERROR: $1"
    exit 1
}

# Field-aware pg_hba.conf handling. One program, two modes (-v mode=...):
#   detect  - print "<line number>: <line>" for every rule whose auth method is trust
#   rewrite - copy the file to stdout with trust methods replaced by md5, and drop
#             the two comment lines the image adds next to a trust rule
#
# Rule syntax (comments and blank lines ignored):
#   local      DATABASE USER                   METHOD
#   host*      DATABASE USER ADDRESS           METHOD   (ADDRESS may be CIDR or a hostname)
#   host*      DATABASE USER IP-ADDRESS MASK   METHOD   (bare IP followed by a netmask)
# A database or user that happens to be called "trust" is never a method.
# Quoted tokens may contain blanks; an unquoted # starts a comment.
# Written for POSIX awk (mawk in the postgres image has no gensub/match groups).
HBA_AWK='
function is_bare_ip(s) {
    if (s ~ /\//) return 0
    if (s ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) return 1
    if (s ~ /:/ && s ~ /^[0-9A-Fa-f:.]+$/) return 1
    return 0
}
{
    len = length($0); n = 0; i = 1
    while (i <= len) {
        c = substr($0, i, 1)
        if (c == " " || c == "\t") { i++; continue }
        if (c == "#") break
        start = i; inq = 0
        while (i <= len) {
            c = substr($0, i, 1)
            if (c == "\"") inq = !inq
            else if (!inq && (c == " " || c == "\t" || c == "#")) break
            i++
        }
        n++; ts[n] = start; te[n] = i - 1; tv[n] = substr($0, start, i - start)
    }
    idx = 0
    if (n >= 1) {
        if (tv[1] == "local") idx = 4
        else if (tv[1] ~ /^host(ssl|nossl|gssenc|nogssenc)?$/) {
            idx = 5
            if (n >= 5 && is_bare_ip(tv[5])) idx = 6
        }
    }
    hit = (idx > 0 && n >= idx && tv[idx] == "trust")
    if (mode == "detect") {
        if (hit) print NR ": " $0
        next
    }
    if (mode == "rewrite") {
        if ($0 ~ /^# warning trust is enabled for all connections[ \t]*$/) next
        if ($0 ~ /^# see https:\/\/www\.postgresql\.org\/docs\/[0-9a-z.]+\/auth-trust\.html[ \t]*$/) next
        if (hit) { print substr($0, 1, ts[idx] - 1) "md5" substr($0, te[idx] + 1); next }
        print
    }
}
'

as_postgres() {
    if [ "$(id -u)" = '0' ]; then
        gosu postgres "$@"
    else
        "$@"
    fi
}

# Print legacy trust rules found in the given hba file (empty output = none).
find_trust_rules() {
    awk -v mode=detect "$HBA_AWK" "$1"
}

MAINT_DIR=""
MAINT_STARTED=""

cleanup_maintenance() {
    if [ -n "$MAINT_STARTED" ]; then
        as_postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true
        MAINT_STARTED=""
    fi
    if [ -n "$MAINT_DIR" ]; then
        rm -rf "$MAINT_DIR"
        MAINT_DIR=""
    fi
}

read_superuser_password() {
    local password=""
    if [ -n "${POSTGRES_PASSWORD_FILE:-}" ] && [ -r "$POSTGRES_PASSWORD_FILE" ]; then
        password=$(tr -d '\r\n' < "$POSTGRES_PASSWORD_FILE")
    fi
    if [ -z "$password" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
        password=$(printf '%s' "$POSTGRES_PASSWORD" | tr -d '\r\n')
    fi
    printf '%s' "$password"
}

repair_data_directory() {
    local hba_file="$1"
    shift
    local superuser="${POSTGRES_USER:-postgres}"
    local password hash

    password=$(read_superuser_password)
    if [ -z "$password" ]; then
        die "Legacy trust rules found in $hba_file but no postgres password is available (POSTGRES_PASSWORD_FILE / POSTGRES_PASSWORD is empty). Refusing to start. $DOCS_HINT"
    fi
    hash="md5$(printf '%s%s' "$password" "$superuser" | md5sum | cut -d' ' -f1)"
    password=""

    # Maintenance server: no TCP listener, socket in a private directory, and an
    # hba that only admits the superuser over that socket.
    MAINT_DIR=$(mktemp -d)
    chmod 700 "$MAINT_DIR"
    [ "$(id -u)" = '0' ] && chown postgres "$MAINT_DIR"
    printf 'local all "%s" trust\n' "${superuser//\"/\"\"}" > "$MAINT_DIR/hba"
    chmod 600 "$MAINT_DIR/hba"
    [ "$(id -u)" = '0' ] && chown postgres "$MAINT_DIR/hba"

    local server_opts
    server_opts="$(printf '%q ' "$@")-c listen_addresses='' -c port=5432 -c unix_socket_directories=$MAINT_DIR -c hba_file=$MAINT_DIR/hba -c password_encryption=md5"

    log "Legacy trust rules found in $hba_file; starting socket-only maintenance server to require password authentication"
    trap cleanup_maintenance EXIT
    if ! as_postgres pg_ctl -D "$PGDATA" -w -t 60 -l "$MAINT_DIR/server.log" -o "$server_opts" start >/dev/null; then
        cat "$MAINT_DIR/server.log" >&2 || true
        die "Maintenance server did not start; refusing to start Postgres"
    fi
    MAINT_STARTED=1

    local psql_base=(psql -X -v ON_ERROR_STOP=1 -h "$MAINT_DIR" -p 5432 -U "$superuser" -d postgres)

    # Report only: app_user / hocuspocus_user passwords are owned by create_database.js.
    local no_password
    no_password=$(as_postgres "${psql_base[@]}" -At -c \
        "SELECT rolname FROM pg_authid WHERE rolcanlogin AND rolpassword IS NULL AND rolname <> current_user ORDER BY 1" | paste -sd, -)
    if [ -n "$no_password" ]; then
        log "WARNING: login roles without a password (they cannot log in over the network until one is set): $no_password"
    fi

    # psql variables are not interpolated with -c, so the statement goes in on stdin.
    # The hash (not the password) is the only secret material and stays off the command line.
    as_postgres "${psql_base[@]}" -v u="$superuser" <<SQL >/dev/null
\\set h $hash
ALTER ROLE :"u" WITH PASSWORD :'h';
SQL
    hash=""

    as_postgres pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null
    MAINT_STARTED=""
    rm -rf "$MAINT_DIR"
    MAINT_DIR=""
    trap - EXIT

    # Keep the original; never overwrite an earlier backup.
    local backup="$PGDATA/$BACKUP_NAME"
    if [ -e "$backup" ]; then
        backup="$backup.$(date +%s)"
    fi
    ( umask 077; cp "$hba_file" "$backup" )
    chmod 600 "$backup"
    [ "$(id -u)" = '0' ] && chown postgres "$backup"

    local tmp_hba
    tmp_hba=$(mktemp "$(dirname "$hba_file")/.pg_hba.conf.XXXXXX")
    awk -v mode=rewrite "$HBA_AWK" "$hba_file" > "$tmp_hba"
    chmod 600 "$tmp_hba"
    [ "$(id -u)" = '0' ] && chown postgres "$tmp_hba"
    mv "$tmp_hba" "$hba_file"

    local remaining
    remaining=$(find_trust_rules "$hba_file")
    if [ -n "$remaining" ]; then
        log "Trust rules still present after rewrite:"
        echo "$remaining"
        die "Could not remove legacy trust rules; refusing to start Postgres"
    fi

    log "Repaired legacy trust rules in $hba_file (now md5); superuser '$superuser' password synced to the configured secret; original saved to $backup"
}

main() {
    # Only act for the server itself, not for `postgres --help`, `bash`, etc.
    local first="${1:-}"
    if [ "${first:0:1}" = '-' ]; then
        set -- postgres "$@"
    fi
    if [ "${1:-}" != 'postgres' ]; then
        exec docker-entrypoint.sh "$@"
    fi
    local arg
    for arg in "$@"; do
        case "$arg" in
            -'?'|--help|-V|--version) exec docker-entrypoint.sh "$@" ;;
        esac
    done

    PGDATA="${PGDATA:-/var/lib/postgresql/data}"
    export PGDATA

    local method="${POSTGRES_HOST_AUTH_METHOD:-}"
    method="${method,,}"
    method="${method//[[:space:]]/}"
    if [ "$method" = 'trust' ]; then
        die "POSTGRES_HOST_AUTH_METHOD=trust is not allowed: Postgres must require password authentication. Remove it or set it to md5. $DOCS_HINT"
    fi

    # Fresh install: nothing to repair; the stock entrypoint initialises the cluster.
    if [ ! -s "$PGDATA/PG_VERSION" ]; then
        log "Fast path: no existing data directory, nothing to repair"
        exec docker-entrypoint.sh "$@"
    fi

    local hba_file
    hba_file=$(as_postgres postgres -C hba_file "${@:2}" 2>/dev/null || true)
    hba_file="${hba_file:-$PGDATA/pg_hba.conf}"

    if [ ! -f "$hba_file" ]; then
        die "pg_hba.conf not found at $hba_file; refusing to start"
    fi

    local rules
    rules=$(find_trust_rules "$hba_file")
    if [ -z "$rules" ]; then
        log "Fast path: no legacy trust rules in $hba_file"
        exec docker-entrypoint.sh "$@"
    fi

    log "Legacy trust rules in $hba_file:"
    echo "$rules"
    repair_data_directory "$hba_file" "${@:2}"
    exec docker-entrypoint.sh "$@"
}

main "$@"
