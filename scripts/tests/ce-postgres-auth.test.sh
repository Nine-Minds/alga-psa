#!/usr/bin/env bash
#
# CE Postgres password-authentication harness (scenarios T1-T8, plus T0: parser unit checks).
#
# Runs the real `postgres` service from
#   -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml
# in a disposable sandbox: its own compose project, throwaway secrets and a
# named volume. Nothing in the repository checkout or any other compose
# project is touched; everything is removed on exit.
#
# Usage: scripts/tests/ce-postgres-auth.test.sh [T1 T2 ...]   (default: all)
#
# Environment:
#   CE_POSTGRES_AUTH_T8   auto (default) | 1 | 0
#       T8 brings up PgBouncer (built from ./pgbouncer) and connects through
#       port 6432. The "wrong password is rejected by PgBouncer" assertion needs
#       the PgBouncer auth_type change, so it is skipped with a message while
#       pgbouncer/pgbouncer.ini.template still says `auth_type = trust`.
#       0 skips T8 entirely; 1 makes a skipped part a failure.
#   PG_IMAGE              image used for sibling clients (default ankane/pgvector:latest)
#   TMPDIR                where the sandbox is created (default /tmp). Docker must be able to
#                         bind-mount it; a snap-packaged Docker cannot see /tmp or hidden
#                         directories, so point TMPDIR at a visible directory under $HOME.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_IMAGE="${PG_IMAGE:-ankane/pgvector:latest}"
T8_MODE="${CE_POSTGRES_AUTH_T8:-auto}"

PROJECT="alga-pgauth-test-$$"
SANDBOX="$(mktemp -d)"
NETWORK="${PROJECT}_app-network"
VOLUME="${PROJECT}_postgres_data"

PASSED=0
FAILED=0
SKIPPED=0
RESULTS=()

if [ "$PROJECT" = "alga-psa-local-test" ]; then
    echo "refusing to use the dev stack project name" >&2
    exit 2
fi

log() { echo "[ce-postgres-auth] $*"; }

ok() {
    PASSED=$((PASSED + 1))
    echo "  ok   - $1"
}

nok() {
    FAILED=$((FAILED + 1))
    echo "  FAIL - $1"
    [ -n "${2:-}" ] && echo "         $2"
}

begin() { log "$1"; }
record() { RESULTS+=("$1|$2"); }

# --- sandbox ---------------------------------------------------------------

free_port() {
    python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

prepare_sandbox() {
    cp "$REPO_ROOT/docker-compose.base.yaml" \
       "$REPO_ROOT/docker-compose.prebuilt.base.yaml" \
       "$REPO_ROOT/docker-compose.prebuilt.ce.yaml" "$SANDBOX/"
    cp -R "$REPO_ROOT/postgres" "$REPO_ROOT/pgbouncer" "$SANDBOX/"
    # Files the CE overlay `extends` (resolved at parse time even for a single service).
    mkdir -p "$SANDBOX/server" "$SANDBOX/hocuspocus"
    cp "$REPO_ROOT/server/docker-compose.prebuilt.yaml" "$SANDBOX/server/"
    cp "$REPO_ROOT/hocuspocus/docker-compose.yaml" "$SANDBOX/hocuspocus/"
    mkdir -p "$SANDBOX/secrets"
    local name
    for name in $(sed -n 's#^[[:space:]]*file: \./secrets/\(.*\)$#\1#p' "$SANDBOX/docker-compose.prebuilt.base.yaml"); do
        printf '%s' "throwaway-$name-$$" > "$SANDBOX/secrets/$name"
        chmod 644 "$SANDBOX/secrets/$name"
    done
    SUPER_SECRET="superuser-secret-$$-one"
    APP_SECRET="$(cat "$SANDBOX/secrets/db_password_server")"
    set_superuser_secret "$SUPER_SECRET"

    cat > "$SANDBOX/legacy.override.yaml" <<'YAML'
# Emulates how earlier releases initialised the volume: stock entrypoint, trust env.
services:
  postgres:
    entrypoint: ["docker-entrypoint.sh"]
    environment:
      POSTGRES_HOST_AUTH_METHOD: trust
YAML
    cat > "$SANDBOX/trustenv.override.yaml" <<'YAML'
# Wrapper stays in place; only the (now forbidden) env value is set.
services:
  postgres:
    environment:
      POSTGRES_HOST_AUTH_METHOD: trust
YAML

    export NEXT_PUBLIC_BASE_URL="http://localhost:3000"
    export VERSION="test" APP_NAME="alga-pgauth" HOST="localhost" APP_ENV="development"
    export EXPOSE_DB_PORT
    EXPOSE_DB_PORT="$(free_port)"
    EXPOSE_PGBOUNCER_PORT="$(free_port)"
    export EXPOSE_PGBOUNCER_PORT
}

set_superuser_secret() {
    printf '%s' "$1" > "$SANDBOX/secrets/postgres_password"
    chmod 644 "$SANDBOX/secrets/postgres_password"
}

# Compose prints one "variable is not set" warning per unused app setting; drop them.
compose_quiet() { "$@" 2> >(grep -v 'level=warning' >&2); }

dc() {
    compose_quiet docker compose -p "$PROJECT" --project-directory "$SANDBOX" \
        -f "$SANDBOX/docker-compose.prebuilt.base.yaml" -f "$SANDBOX/docker-compose.prebuilt.ce.yaml" "$@"
}

dc_with() {
    local override="$1"
    shift
    compose_quiet docker compose -p "$PROJECT" --project-directory "$SANDBOX" \
        -f "$SANDBOX/docker-compose.prebuilt.base.yaml" -f "$SANDBOX/docker-compose.prebuilt.ce.yaml" \
        -f "$SANDBOX/$override" "$@"
}

cleanup() {
    local rc=$?
    log "Cleaning up compose project $PROJECT"
    dc down -v --remove-orphans >/dev/null 2>&1 || true
    docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
    docker rmi -f "${PROJECT}-pgbouncer" >/dev/null 2>&1 || true
    rm -rf "$SANDBOX"
    exit $rc
}
trap cleanup EXIT

# --- helpers ---------------------------------------------------------------

# sibling_psql <host> <port> <user> <password|""> <psql args...>
# Runs psql from a throwaway container on the stack network. An empty password
# means "send none" (-w makes psql fail instead of prompting).
sibling_psql() {
    local host="$1" port="$2" user="$3" password="$4"
    shift 4
    local env_args=(-e PGCONNECT_TIMEOUT=5)
    [ -n "$password" ] && env_args+=(-e "PGPASSWORD=$password")
    docker run --rm --network "$NETWORK" "${env_args[@]}" --entrypoint psql "$PG_IMAGE" \
        -X -w -h "$host" -p "$port" -U "$user" -d postgres "$@" 2>&1
}

pg() { sibling_psql postgres 5432 "$@"; }

container_state() {
    local cid
    cid="$(dc ps -a -q postgres 2>/dev/null | head -n1)"
    [ -n "$cid" ] && docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null
}

container_exit_code() {
    docker inspect -f '{{.State.ExitCode}}' "$(dc ps -a -q postgres | head -n1)"
}

# wait_ready <superuser password> -> 0 ready, 1 timeout, 2 container exited, 3 no container
wait_ready() {
    local password="$1" i state
    for ((i = 0; i < 90; i++)); do
        state="$(container_state)"
        [ "$state" = "exited" ] && return 2
        [ -z "$state" ] && [ "$i" -ge 10 ] && return 3
        if pg postgres "$password" -tAc 'select 1' >/dev/null 2>&1; then return 0; fi
        sleep 1
    done
    return 1
}

wait_exited() {
    local i
    for ((i = 0; i < 60; i++)); do
        [ "$(container_state)" = "exited" ] && return 0
        sleep 1
    done
    return 1
}

# up_postgres [override]: start the postgres service; print compose's error if it cannot.
up_postgres() {
    local out
    if [ -n "${1:-}" ]; then
        out="$(dc_with "$1" up -d postgres 2>&1)"
    else
        out="$(dc up -d postgres 2>&1)"
    fi || { echo "$out" | tail -5; return 1; }
}

pg_exec() { dc exec -T postgres bash -c "$1"; }

hba_active_lines() { pg_exec 'grep -v "^[[:space:]]*#" "$PGDATA/pg_hba.conf" | grep -v "^[[:space:]]*$"'; }

trust_rule_count() { pg "$1" "$2" -tAc "select count(*) from pg_hba_file_rules where auth_method = 'trust'" | tr -d '[:space:]'; }

postgres_logs() { dc logs --no-color postgres 2>&1; }

# Start from an empty volume initialised the way earlier releases did it:
# trust env, base initdb args, md5 command, app_user created with its secret.
legacy_init() {
    dc down -v --remove-orphans >/dev/null 2>&1
    docker volume rm -f "$VOLUME" >/dev/null 2>&1
    set_superuser_secret "$SUPER_SECRET"
    up_postgres legacy.override.yaml || return 1
    wait_ready "$SUPER_SECRET" || return 1
    pg postgres "$SUPER_SECRET" -c "CREATE ROLE app_user LOGIN PASSWORD '$APP_SECRET'" >/dev/null || return 1
    # Precondition: this really is the legacy layout.
    grep -q '^host all all all trust' <<<"$(hba_active_lines)" || return 1
    dc down >/dev/null 2>&1
}

# --- scenarios -------------------------------------------------------------

# T0 is the wrapper's field-aware pg_hba parser, run on the host (no containers).
t0_field_aware_parser() {
    begin "T0 field-aware trust detection and rewrite"
    local awk_src sample="$SANDBOX/hba.sample" out
    awk_src="$(sed -n "/^HBA_AWK='/,/^'\$/p" "$REPO_ROOT/postgres/alga-postgres-entrypoint.sh" | sed "1s/^HBA_AWK='//;\$d")"
    cat > "$sample" <<'HBA'
# TYPE DATABASE USER ADDRESS METHOD
local   all   postgres   trust
local   trust trust      md5
host    trust trust  127.0.0.1/32   md5
host    all   all   10.0.0.1  255.255.255.255   trust   # with netmask
hostssl all   all   ::1/128 trust
host    "trust db" all  all   scram-sha-256
   # commented trust rule
host    all   all   all   md5

# warning trust is enabled for all connections
# see https://www.postgresql.org/docs/12/auth-trust.html
host all all all trust
HBA
    out="$(awk -v mode=detect "$awk_src" "$sample" | cut -d: -f1 | paste -sd, -)"
    [ "$out" = "2,5,6,13" ] && ok "detects only real trust methods (lines $out)" || nok "detects only real trust methods" "got lines: $out"
    out="$(awk -v mode=rewrite "$awk_src" "$sample")"
    if [ "$(awk -v mode=detect "$awk_src" <<<"$out" | wc -l)" = "0" ] \
        && grep -q '^host    trust trust  127.0.0.1/32   md5$' <<<"$out" \
        && grep -q '^host    all   all   10.0.0.1  255.255.255.255   md5   # with netmask$' <<<"$out" \
        && grep -q '^   # commented trust rule$' <<<"$out" \
        && ! grep -q 'warning trust is enabled' <<<"$out"; then
        ok "rewrite changes only the method and drops the image's warning comments"
    else
        nok "rewrite changes only the method and drops the image's warning comments" "$out"
    fi
}

t1_fresh_install() {
    begin "T1 fresh install"
    dc down -v --remove-orphans >/dev/null 2>&1
    docker volume rm -f "$VOLUME" >/dev/null 2>&1
    set_superuser_secret "$SUPER_SECRET"
    up_postgres
    if ! wait_ready "$SUPER_SECRET"; then
        nok "postgres became ready with the secret"
        postgres_logs | tail -20
        return
    fi
    ok "postgres became ready with the secret"
    grep -Eq '[[:space:]]trust([[:space:]]|$)' <<<"$(hba_active_lines)" && nok "pg_hba.conf file has no trust rule" || ok "pg_hba.conf file has no trust rule"
    [ "$(trust_rule_count postgres "$SUPER_SECRET")" = "0" ] && ok "pg_hba_file_rules reports no trust rule" || nok "pg_hba_file_rules reports no trust rule"
    local out
    out="$(pg postgres "" -tAc 'select 1')"
    if grep -q 'fe_sendauth: no password supplied' <<<"$out"; then
        ok "passwordless psql fails with fe_sendauth: no password supplied"
    else
        nok "passwordless psql fails with fe_sendauth: no password supplied" "$out"
    fi
    out="$(pg postgres "$SUPER_SECRET" -tAc 'select 1')"
    [ "$out" = "1" ] && ok "psql with the secret succeeds" || nok "psql with the secret succeeds" "$out"
    grep -q 'Fast path: no existing data directory' <<<"$(postgres_logs)" && ok "wrapper logged the fast path" || nok "wrapper logged the fast path"
}

t2_upgrade_from_legacy() {
    begin "T2 upgrade from the earlier layout (trust volume)"
    if ! legacy_init; then
        nok "legacy volume initialised with trust"
        return 1
    fi
    ok "legacy volume initialised with trust"
    up_postgres
    wait_ready "$SUPER_SECRET"
    local rc=$?
    if [ $rc -ne 0 ]; then
        nok "postgres started after upgrade (rc=$rc)"
        postgres_logs | tail -30
        return 1
    fi
    ok "postgres started after upgrade"
    grep -q 'Repaired legacy trust rules' <<<"$(postgres_logs)" && ok "wrapper logged the repair" || nok "wrapper logged the repair"
    [ "$(trust_rule_count postgres "$SUPER_SECRET")" = "0" ] && ok "pg_hba_file_rules reports no trust rule" || nok "pg_hba_file_rules reports no trust rule"
    grep -Eq '[[:space:]]trust([[:space:]]|$)' <<<"$(hba_active_lines)" && nok "pg_hba.conf file has no trust rule" || ok "pg_hba.conf file has no trust rule"
    local mode
    mode="$(pg_exec 'stat -c %a "$PGDATA/pg_hba.conf.pre-trust-removal"' | tr -d '[:space:]')"
    [ "$mode" = "600" ] && ok "backup exists with mode 600" || nok "backup exists with mode 600" "mode=$mode"
    pg_exec 'grep -q "^host all all all trust" "$PGDATA/pg_hba.conf.pre-trust-removal"' && ok "backup holds the original file" || nok "backup holds the original file"
    local out
    out="$(pg postgres "" -tAc 'select 1')"
    grep -q 'fe_sendauth: no password supplied' <<<"$out" && ok "passwordless psql fails" || nok "passwordless psql fails" "$out"
    out="$(pg postgres "$SUPER_SECRET" -tAc 'select 1')"
    [ "$out" = "1" ] && ok "postgres role works with the secret" || nok "postgres role works with the secret" "$out"
    out="$(pg app_user "$APP_SECRET" -tAc 'select 1')"
    [ "$out" = "1" ] && ok "app_user still works with its own secret" || nok "app_user still works with its own secret" "$out"
}

t3_drifted_secret() {
    begin "T3 upgrade with a rotated superuser secret"
    if ! legacy_init; then
        nok "legacy volume initialised with trust"
        return 1
    fi
    local rotated="superuser-secret-$$-rotated"
    set_superuser_secret "$rotated"
    up_postgres
    wait_ready "$rotated"
    local rc=$?
    if [ $rc -ne 0 ]; then
        nok "postgres started and accepts the rotated secret (rc=$rc)"
        postgres_logs | tail -30
        return 1
    fi
    ok "postgres started and accepts the rotated secret"
    local out
    out="$(pg postgres "$SUPER_SECRET" -tAc 'select 1')"
    grep -q 'password authentication failed' <<<"$out" && ok "the previous password no longer works" || nok "the previous password no longer works" "$out"
    [ "$(trust_rule_count postgres "$rotated")" = "0" ] && ok "no trust rule remains" || nok "no trust rule remains"
}

t4_idempotent_restart() {
    begin "T4 restart is a no-op"
    if ! legacy_init; then
        nok "legacy volume initialised with trust"
        return 1
    fi
    up_postgres
    wait_ready "$SUPER_SECRET" || { nok "postgres started after upgrade"; return 1; }
    local before_sum after_sum repairs_before repairs_after fast_before fast_after
    before_sum="$(pg_exec 'sha256sum "$PGDATA/pg_hba.conf"')"
    repairs_before="$(postgres_logs | grep -c 'Repaired legacy trust rules')"
    fast_before="$(postgres_logs | grep -c 'Fast path: no legacy trust rules')"
    dc stop postgres >/dev/null 2>&1
    dc start postgres >/dev/null 2>&1
    wait_ready "$SUPER_SECRET" || { nok "postgres restarted"; return 1; }
    after_sum="$(pg_exec 'sha256sum "$PGDATA/pg_hba.conf"')"
    repairs_after="$(postgres_logs | grep -c 'Repaired legacy trust rules')"
    fast_after="$(postgres_logs | grep -c 'Fast path: no legacy trust rules')"
    [ "$before_sum" = "$after_sum" ] && ok "pg_hba.conf is byte-identical after restart" || nok "pg_hba.conf is byte-identical after restart" "$before_sum / $after_sum"
    [ "$repairs_before" = "$repairs_after" ] && ok "no repair log lines on restart" || nok "no repair log lines on restart"
    [ "$fast_after" -gt "$fast_before" ] && ok "restart took the fast path" || nok "restart took the fast path"
}

t5_empty_secret_fails_closed() {
    begin "T5 fail closed: trust volume + empty secret"
    if ! legacy_init; then
        nok "legacy volume initialised with trust"
        return 1
    fi
    set_superuser_secret ""
    up_postgres
    if ! wait_exited; then
        nok "container exits"
        return 1
    fi
    ok "container exits"
    local code
    code="$(container_exit_code)"
    [ "$code" != "0" ] && ok "exit code is non-zero ($code)" || nok "exit code is non-zero"
    grep -q 'no postgres password is available' <<<"$(postgres_logs)" && ok "log explains the refusal" || nok "log explains the refusal"
    grep -q 'ready to accept connections' <<<"$(postgres_logs)" && nok "server never reached ready" || ok "server never reached ready"
    (exec 3<>"/dev/tcp/127.0.0.1/$EXPOSE_DB_PORT") 2>/dev/null && nok "published port 5432 is closed" || ok "published port 5432 is closed"
    set_superuser_secret "$SUPER_SECRET"
}

t6_trust_env_fails_closed() {
    begin "T6 fail closed: fresh volume + POSTGRES_HOST_AUTH_METHOD=trust"
    dc down -v --remove-orphans >/dev/null 2>&1
    docker volume rm -f "$VOLUME" >/dev/null 2>&1
    set_superuser_secret "$SUPER_SECRET"
    up_postgres trustenv.override.yaml
    if ! wait_exited; then
        nok "container exits"
        return 1
    fi
    ok "container exits"
    local code
    code="$(container_exit_code)"
    [ "$code" != "0" ] && ok "exit code is non-zero ($code)" || nok "exit code is non-zero"
    grep -q 'POSTGRES_HOST_AUTH_METHOD=trust is not allowed' <<<"$(postgres_logs)" && ok "log explains the refusal" || nok "log explains the refusal"
    docker run --rm -v "$VOLUME:/d:ro" --entrypoint sh "$PG_IMAGE" -c 'test ! -e /d/PG_VERSION' \
        && ok "refused before initdb (no PG_VERSION in the volume)" || nok "refused before initdb (no PG_VERSION in the volume)"
}

# Runs assert_no_trust_auth from the real setup/entrypoint.sh against the postgres service.
run_guard() {
    docker run --rm --network "$NETWORK" \
        -e DB_HOST_ADMIN="${1:-postgres}" -e DB_PORT_ADMIN=5432 \
        -v "$REPO_ROOT/setup/entrypoint.sh:/app/setup/entrypoint.sh:ro" \
        -v "$SANDBOX/secrets/postgres_password:/run/secrets/postgres_password:ro" \
        --entrypoint bash "$PG_IMAGE" -c 'source /app/setup/entrypoint.sh; assert_no_trust_auth' 2>&1
}

t7_setup_guard() {
    begin "T7 setup guard"
    if ! legacy_init; then
        nok "legacy volume initialised with trust"
        return 1
    fi
    up_postgres
    wait_ready "$SUPER_SECRET" || { nok "postgres started after upgrade"; return 1; }
    local out rc

    out="$(run_guard postgres)"; rc=$?
    [ $rc -eq 0 ] && ok "guard passes on the repaired server" || nok "guard passes on the repaired server" "$out"

    out="$(run_guard pgbouncer)"; rc=$?
    [ $rc -eq 0 ] && ok "guard falls back from the PgBouncer host to direct Postgres" || nok "guard falls back from the PgBouncer host to direct Postgres" "$out"

    pg_exec 'cp "$PGDATA/pg_hba.conf" /tmp/hba.keep && echo "host all all all trust" >> "$PGDATA/pg_hba.conf"' >/dev/null
    pg postgres "$SUPER_SECRET" -tAc 'select pg_reload_conf()' >/dev/null
    out="$(run_guard postgres)"; rc=$?
    if [ $rc -eq 1 ] && grep -q '| trust |' <<<"$out"; then
        ok "guard exits 1 and lists the trust rule"
    else
        nok "guard exits 1 and lists the trust rule (rc=$rc)" "$out"
    fi

    pg_exec 'cat /tmp/hba.keep > "$PGDATA/pg_hba.conf" && echo "host all all all bogusmethod" >> "$PGDATA/pg_hba.conf"' >/dev/null
    pg postgres "$SUPER_SECRET" -tAc 'select pg_reload_conf()' >/dev/null
    out="$(run_guard postgres)"; rc=$?
    [ $rc -eq 1 ] && ok "guard exits 1 on an unparseable rule" || nok "guard exits 1 on an unparseable rule (rc=$rc)" "$out"

    pg_exec 'cat /tmp/hba.keep > "$PGDATA/pg_hba.conf"' >/dev/null
    pg postgres "$SUPER_SECRET" -tAc 'select pg_reload_conf()' >/dev/null
    out="$(run_guard postgres)"; rc=$?
    [ $rc -eq 0 ] && ok "guard passes once the rule is removed" || nok "guard passes once the rule is removed" "$out"
}

t8_through_pgbouncer() {
    begin "T8 app roles through PgBouncer after the upgrade"
    if [ "$T8_MODE" = "0" ]; then
        echo "  skip - disabled by CE_POSTGRES_AUTH_T8=0"
        SKIPPED=$((SKIPPED + 1))
        return
    fi
    if ! legacy_init; then
        nok "legacy volume initialised with trust"
        return 1
    fi
    up_postgres
    wait_ready "$SUPER_SECRET" || { nok "postgres started after upgrade"; return 1; }
    local build_log
    if ! build_log="$(dc up -d --build pgbouncer 2>&1)"; then
        if [ "$T8_MODE" = "1" ]; then
            nok "pgbouncer built and started" "$build_log"
        else
            echo "  skip - pgbouncer image could not be built/started here (set CE_POSTGRES_AUTH_T8=1 to require it)"
            SKIPPED=$((SKIPPED + 1))
        fi
        return
    fi
    sleep 3
    local out
    out="$(sibling_psql pgbouncer 6432 app_user "$APP_SECRET" -tAc 'select current_user')"
    [ "$out" = "app_user" ] && ok "app_user connects through 6432 with its secret" || nok "app_user connects through 6432 with its secret" "$out"
    out="$(sibling_psql pgbouncer 6432 postgres "$SUPER_SECRET" -tAc 'select current_user')"
    [ "$out" = "postgres" ] && ok "postgres connects through 6432 with the secret" || nok "postgres connects through 6432 with the secret" "$out"

    if grep -Eq '^[[:space:]]*auth_type[[:space:]]*=[[:space:]]*trust' "$REPO_ROOT/pgbouncer/pgbouncer.ini.template"; then
        if [ "$T8_MODE" = "1" ]; then
            nok "PgBouncer rejects a wrong password (needs the PgBouncer auth_type change)"
        else
            echo "  skip - 'PgBouncer rejects a wrong password': pgbouncer.ini.template still has auth_type = trust (sibling PgBouncer change)"
            SKIPPED=$((SKIPPED + 1))
        fi
    else
        out="$(sibling_psql pgbouncer 6432 app_user "wrong-password" -tAc 'select 1')"
        grep -qi 'password authentication failed\|authentication failed' <<<"$out" \
            && ok "PgBouncer rejects a wrong password" || nok "PgBouncer rejects a wrong password" "$out"
    fi
}

# --- main ------------------------------------------------------------------

main() {
    command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
    prepare_sandbox
    log "project=$PROJECT sandbox=$SANDBOX"
    docker pull -q "$PG_IMAGE" >/dev/null 2>&1 || true

    local selected=("$@")
    [ ${#selected[@]} -eq 0 ] && selected=(T0 T1 T2 T3 T4 T5 T6 T7 T8)
    local t
    for t in "${selected[@]}"; do
        local before_failed=$FAILED
        case "$t" in
            T0) t0_field_aware_parser ;;
            T1) t1_fresh_install ;;
            T2) t2_upgrade_from_legacy ;;
            T3) t3_drifted_secret ;;
            T4) t4_idempotent_restart ;;
            T5) t5_empty_secret_fails_closed ;;
            T6) t6_trust_env_fails_closed ;;
            T7) t7_setup_guard ;;
            T8) t8_through_pgbouncer ;;
            *) echo "unknown scenario: $t" >&2; exit 2 ;;
        esac
        if [ "$FAILED" -gt "$before_failed" ]; then record "$t" FAIL; else record "$t" PASS; fi
    done

    echo
    log "Summary"
    local r
    for r in "${RESULTS[@]}"; do echo "  ${r%%|*}: ${r##*|}"; done
    echo "  assertions passed=$PASSED failed=$FAILED skipped=$SKIPPED"
    [ "$FAILED" -eq 0 ]
}

main "$@"
