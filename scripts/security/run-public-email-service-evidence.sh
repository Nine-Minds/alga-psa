#!/usr/bin/env bash
# Prepare a scoped fixture run, then capture one bounded production worker run.
set -Eeuo pipefail
set +x

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PRIVATE=${PRIVATE_EVIDENCE_DIR:-/home/robert/alga-review-private/3276c089}
fail() { printf 'public email evidence: %s\n' "$*" >&2; exit 2; }
need() { [[ -n "${!1:-}" ]] || fail "missing required environment variable $1"; }
actual_sha=$(git -C "$REPO" rev-parse HEAD)
if [[ -n "${EXPECTED_SOURCE_REVISION:-}" ]]; then
  [[ "$actual_sha" == "$EXPECTED_SOURCE_REVISION" ]] || fail "expected repository revision $EXPECTED_SOURCE_REVISION, found $actual_sha"
fi
export EFFECTIVE_SOURCE_REVISION="$actual_sha"
need EVIDENCE_PHASE
need SCENARIO
case "$SCENARIO" in
  password-baseline|oauth-baseline|rename-preserve|scope-change|replacement|oauth-reconnect|oauth-refresh) ;;
  *) fail 'unsupported SCENARIO' ;;
esac
need EVIDENCE_RUN_ID
[[ "$EVIDENCE_RUN_ID" =~ ^[A-Za-z0-9_.-]{1,100}$ ]] || fail 'invalid EVIDENCE_RUN_ID'
need FIXTURE_API_BASE_URL
need FIXTURE_ADMIN_TOKEN_FILE
need EMAIL_SERVICE_ENV_FILE
need UI_SERVER_PID
need TENANT_ID
need PROVIDER_ID
[[ "$FIXTURE_API_BASE_URL" == https://* ]] || fail 'fixture management API must use HTTPS'
[[ -r "$FIXTURE_ADMIN_TOKEN_FILE" ]] || fail 'fixture admin token file is not readable'
mode=$(stat -c '%a' "$FIXTURE_ADMIN_TOKEN_FILE")
[[ "$mode" == 600 || "$mode" == 400 ]] || fail 'fixture admin token file must have mode 600 or 400'
[[ "$FIXTURE_ADMIN_TOKEN_FILE" != "$REPO"/* ]] || fail 'fixture admin token must remain outside the repository'
[[ -r "$EMAIL_SERVICE_ENV_FILE" ]] || fail 'EMAIL_SERVICE_ENV_FILE is not readable'
mode=$(stat -c '%a' "$EMAIL_SERVICE_ENV_FILE")
[[ "$mode" == 600 || "$mode" == 400 ]] || fail 'service env file must have mode 600 or 400'
[[ "$EMAIL_SERVICE_ENV_FILE" != "$REPO"/* ]] || fail 'service env file must remain outside the repository'
# shellcheck disable=SC1090
set -a
source "$EMAIL_SERVICE_ENV_FILE"
set +a
need DB_NAME_SERVER
need SECRET_FS_BASE_PATH
[[ "$DB_NAME_SERVER" == smoke_imap_public_* ]] || fail 'DB_NAME_SERVER must start smoke_imap_public_'
[[ "$SECRET_FS_BASE_PATH" == /* && -d "$SECRET_FS_BASE_PATH" ]] || fail 'shared secret filesystem must be absolute and exist'
secret_realpath=$(realpath -e "$SECRET_FS_BASE_PATH")
[[ "$secret_realpath" != "$(realpath -e "$REPO")"/* ]] || fail 'shared secret filesystem must remain outside the repository'
[[ ",$SECRET_READ_CHAIN," == *,filesystem,* ]] || fail 'SECRET_READ_CHAIN must include filesystem for scoped IMAP credentials'
[[ "$SECRET_WRITE_PROVIDER" == filesystem ]] || fail 'SECRET_WRITE_PROVIDER must be filesystem for scoped IMAP credentials'

verify_ui_runtime() {
  [[ "$UI_SERVER_PID" =~ ^[0-9]+$ && -r "/proc/$UI_SERVER_PID/environ" ]] || fail 'UI_SERVER_PID must identify the live registered dev-server process'
  local binding
  binding=$(node - "$UI_SERVER_PID" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const pid = process.argv[2];
const expected = {
  DB_NAME_SERVER: process.env.DB_NAME_SERVER,
  SECRET_FS_BASE_PATH: process.env.SECRET_FS_BASE_PATH,
  SECRET_READ_CHAIN: process.env.SECRET_READ_CHAIN,
  SECRET_WRITE_PROVIDER: process.env.SECRET_WRITE_PROVIDER,
  DB_HOST: process.env.DB_HOST,
  DB_PORT: process.env.DB_PORT,
  DB_HOST_ADMIN: process.env.DB_HOST_ADMIN,
  DB_PORT_ADMIN: process.env.DB_PORT_ADMIN,
  DB_USER_ADMIN: process.env.DB_USER_ADMIN,
  DB_PASSWORD_ADMIN: process.env.DB_PASSWORD_ADMIN,
  PORT: '3948',
};
const cwd = fs.realpathSync(`/proc/${pid}/cwd`);
if (cwd !== path.resolve(process.env.REPO, 'server')) throw new Error('UI server cwd is not the registered server directory');
const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
if (!argv.includes('dev-server.ts')) throw new Error('UI_SERVER_PID is not the registered development server process');
const env = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map((item) => {
  const i = item.indexOf('='); return [item.slice(0, i), item.slice(i + 1)];
}));
for (const [key, value] of Object.entries(expected)) {
  if (value !== undefined && env[key] !== value) throw new Error(`UI dev-server ${key} does not match EMAIL_SERVICE_ENV_FILE`);
}
for (const key of ['DB_NAME_SERVER', 'SECRET_FS_BASE_PATH', 'SECRET_READ_CHAIN', 'SECRET_WRITE_PROVIDER']) {
  if (!env[key]) throw new Error(`UI dev-server is missing required isolated runtime setting ${key}`);
}
const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
const startTicks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
process.stdout.write(JSON.stringify({ pid: Number(pid), cwd, startTicks, database: env.DB_NAME_SERVER, secretPath: fs.realpathSync(env.SECRET_FS_BASE_PATH) }));
NODE
  ) || fail 'UI dev-server is not configured for the isolated runtime'
  printf '%s' "$binding"
  ss -ltnp | grep -F "pid=$UI_SERVER_PID," >/dev/null || fail 'UI_SERVER_PID is not listening on the required dev-server port'
  local ui_status
  ui_status=$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' \
    'http://feature-security-secrets-in-persistimapconfig.localhost:3948/msp/settings/email') \
    || fail 'card-origin email settings route is not reachable'
  [[ "$ui_status" == 200 || "$ui_status" == 302 || "$ui_status" == 307 ]] || fail "card-origin email settings returned HTTP $ui_status"
}

run_dir="$PRIVATE/evidence-runs/$EVIDENCE_RUN_ID"
mkdir -p "$PRIVATE/evidence-runs"
chmod 700 "$PRIVATE/evidence-runs"
export REPO DB_NAME_SERVER SECRET_FS_BASE_PATH SECRET_READ_CHAIN SECRET_WRITE_PROVIDER DB_HOST DB_PORT DB_HOST_ADMIN DB_PORT_ADMIN DB_USER_ADMIN
api_host=$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$FIXTURE_API_BASE_URL")
export api_host FIXTURE_API_BASE_URL
(cd "$REPO" && "$REPO/node_modules/.bin/tsx" -e 'import { assertSafeOutboundHost, assertSafeOutboundUrl } from "./shared/services/net/outboundAddressPolicy.ts"; (async () => { await assertSafeOutboundHost(process.env.api_host!); await assertSafeOutboundUrl(process.env.FIXTURE_API_BASE_URL!); })().catch((e) => { console.error(`fixture management destination rejected: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });')

curl_config=$(mktemp "$PRIVATE/.fixture-curl.XXXXXX")
chmod 600 "$curl_config"
trap 'rm -f "$curl_config"' EXIT
token=$(<"$FIXTURE_ADMIN_TOKEN_FILE")
[[ -n "$token" ]] || fail 'fixture admin token is empty'
[[ "$token" =~ ^[A-Za-z0-9._~-]+$ ]] || fail 'fixture admin token must use a single safe bearer-token line'
printf 'header = "Authorization: Bearer %s"\n' "${token//\\/\\\\}" > "$curl_config"
unset token

case "$EVIDENCE_PHASE" in
  prepare)
    [[ ! -e "$run_dir" ]] || fail "evidence run already exists: $run_dir"
    mkdir -m 700 "$run_dir"
    fingerprint_key_file="$run_dir/scope-fingerprint-key"
    (umask 077; openssl rand -hex 32 > "$fingerprint_key_file") || fail 'could not create the private scope fingerprint key'
    chmod 600 "$fingerprint_key_file"
    binding=$(verify_ui_runtime) || fail 'UI dev-server must share the isolated database and secret filesystem before UI edits'
    printf '%s\n' "$binding" > "$run_dir/runtime-binding.json"
    chmod 600 "$run_dir/runtime-binding.json"
    IMAP_SCOPE_FINGERPRINT_KEY_FILE="$fingerprint_key_file" IMAP_STATE_OUTPUT="$run_dir/provider-before-ui.json" \
      "$REPO/node_modules/.bin/tsx" "$REPO/scripts/security/capture-imap-provider-state.ts"
    reset_body="$run_dir/reset-request.json"
    printf '{"runId":"%s","scenario":"%s"}\n' "$EVIDENCE_RUN_ID" "$SCENARIO" > "$reset_body"
    chmod 600 "$reset_body"
    curl --fail --silent --show-error --max-time 20 --config "$curl_config" \
      -H 'Content-Type: application/json' --data-binary "@$reset_body" \
      "$FIXTURE_API_BASE_URL/v1/runs/$EVIDENCE_RUN_ID/reset" > "$run_dir/reset-response.json" \
      || fail 'fixture reset request failed TLS, authorization, or HTTP validation'
    node - "$run_dir/reset-response.json" "$EVIDENCE_RUN_ID" "$SCENARIO" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.runId !== process.argv[3] || value.scenario !== process.argv[4] || typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) {
  throw new Error('fixture reset response does not identify the requested run and scenario');
}
NODE
    if [[ "$SCENARIO" == scope-change ]]; then
      printf 'Fixture reset and pre-UI state captured. In the real UI, verify a successful connection at the original host, then change the credential scope with blank credentials and leave it saved for capture.\n'
    else
      printf 'Fixture reset and pre-UI state captured. Complete the named real UI scenario, then capture with EVIDENCE_PHASE=capture.\n'
    fi
    ;;
  capture)
    [[ -d "$run_dir" && -f "$run_dir/reset-response.json" ]] || fail 'run must be prepared before capture'
    run_started_at=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).startedAt)' "$run_dir/reset-response.json")
    [[ -f "$run_dir/runtime-binding.json" && -f "$run_dir/provider-before-ui.json" ]] || fail 'prepare must bind the UI runtime and capture pre-UI provider state'
    fingerprint_key_file="$run_dir/scope-fingerprint-key"
    [[ -f "$fingerprint_key_file" ]] || fail 'prepare must retain its private scope fingerprint key through capture'
    need EXPECTED_IMAP_HOST
    need EXPECTED_IMAP_PORT
    need EXPECTED_CREDENTIAL_ID
    need PUBLIC_IMAP_ORIGINAL_HOST
    need PUBLIC_IMAP_REPLACEMENT_HOST
    need PUBLIC_IMAP_PORT
    need PUBLIC_OAUTH_TOKEN_URL
    if [[ "$SCENARIO" == oauth-baseline || "$SCENARIO" == oauth-reconnect || "$SCENARIO" == oauth-refresh ]]; then need EXPECTED_OAUTH_CLIENT_ID; fi
    binding=$(verify_ui_runtime) || fail 'UI dev-server no longer matches the isolated worker database/secret configuration'
    node - "$run_dir/runtime-binding.json" "$binding" <<'NODE'
const fs = require('node:fs');
const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const after = JSON.parse(process.argv[3]);
if (before.pid !== after.pid || before.startTicks !== after.startTicks || before.database !== after.database || before.secretPath !== after.secretPath) {
  throw new Error('registered UI dev-server changed during the real UI scenario');
}
NODE
    IMAP_SCOPE_FINGERPRINT_KEY_FILE="$fingerprint_key_file" IMAP_STATE_OUTPUT="$run_dir/provider-after-ui.json" \
      "$REPO/node_modules/.bin/tsx" "$REPO/scripts/security/capture-imap-provider-state.ts"
    node - "$run_dir/provider-before-ui.json" "$run_dir/provider-after-ui.json" "$run_dir/persisted-provider-state.json" <<'NODE'
const fs = require('node:fs');
const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const after = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
if (before.database !== after.database || before.providerId !== after.providerId) throw new Error('provider snapshots are not from the same database/provider');
fs.writeFileSync(process.argv[4], JSON.stringify({ before, after }, null, 2) + '\n', { mode: 0o600 });
NODE
    [[ -f "$REPO/services/email-service/dist/services/email-service/src/index.js" ]] || fail 'production email-service build is missing'
    export PUBLIC_IMAP_ORIGINAL_HOST PUBLIC_IMAP_REPLACEMENT_HOST PUBLIC_IMAP_PORT PUBLIC_OAUTH_TOKEN_URL
    if [[ "$SCENARIO" == oauth-baseline || "$SCENARIO" == oauth-reconnect || "$SCENARIO" == oauth-refresh ]]; then
      node - "$run_dir/provider-after-ui.json" "$PUBLIC_OAUTH_TOKEN_URL" <<'NODE'
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expected = new URL(process.argv[3]);
if (expected.protocol !== 'https:' || expected.username || expected.password
  || expected.hostname.toLowerCase() !== state.oauthTokenHost
  || Number(expected.port || 443) !== Number(state.oauthTokenPort)) {
  throw new Error('public OAuth token URL does not match the persisted OAuth token recipient');
}
NODE
    fi
    (cd "$REPO" && "$REPO/node_modules/.bin/tsx" -e 'import { assertSafeOutboundHost, assertSafeOutboundUrl } from "./shared/services/net/outboundAddressPolicy.ts"; (async () => { await assertSafeOutboundHost(process.env.PUBLIC_IMAP_ORIGINAL_HOST!); await assertSafeOutboundHost(process.env.PUBLIC_IMAP_REPLACEMENT_HOST!); await assertSafeOutboundUrl(process.env.PUBLIC_OAUTH_TOKEN_URL!); })().catch((e) => { console.error(`public fixture destination rejected: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });')
    for host in "$PUBLIC_IMAP_ORIGINAL_HOST" "$PUBLIC_IMAP_REPLACEMENT_HOST"; do
      timeout 15s openssl s_client -connect "$host:$PUBLIC_IMAP_PORT" -servername "$host" -verify_hostname "$host" -verify_return_error </dev/null >/dev/null 2>&1 || fail "trusted IMAPS TLS validation failed for $host"
    done
    tls_result=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{ssl_verify_result}' "$PUBLIC_OAUTH_TOKEN_URL") || fail 'OAuth HTTPS endpoint TLS connection failed'
    [[ "$tls_result" == 0 ]] || fail "OAuth HTTPS certificate validation failed (curl ssl_verify_result=$tls_result)"

    run_seconds=${EMAIL_SERVICE_RUN_SECONDS:-120}
    [[ "$run_seconds" =~ ^[0-9]+$ && "$run_seconds" -gt 0 ]] || fail 'EMAIL_SERVICE_RUN_SECONDS must be a positive whole number'
    observation_seconds=0
    if [[ "$SCENARIO" == scope-change ]]; then
      observation_seconds=${SCOPE_CHANGE_OBSERVATION_SECONDS:-30}
      [[ "$observation_seconds" =~ ^[0-9]+$ && "$observation_seconds" -gt 0 ]] || fail 'SCOPE_CHANGE_OBSERVATION_SECONDS must be positive whole seconds'
      (( run_seconds >= observation_seconds )) || fail 'email-service run must be at least as long as the scope-change observation interval'
      need ORIGINAL_CREDENTIAL_ID
      need OLD_CREDENTIAL_IDS
    fi
    export MINIMUM_OBSERVATION_SECONDS="$observation_seconds"
    service_log="$run_dir/email-service.log"
    ready_file="$run_dir/readiness.json"
    service_started_at=$(node -e 'process.stdout.write(new Date().toISOString())')
    PORT=${EMAIL_SERVICE_EVIDENCE_PORT:-23958} EVIDENCE_RUN_ID="$EVIDENCE_RUN_ID" \
      NODE_ENV=production timeout --signal=TERM --kill-after=15s "${run_seconds}s" \
      bash -c 'cd "$1"; exec node .' _ "$REPO/services/email-service" > "$service_log" 2>&1 &
    service_pid=$!
    chmod 600 "$service_log"
    ready=0
    for _ in $(seq 1 45); do
      if curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${EMAIL_SERVICE_EVIDENCE_PORT:-23958}/ready" -o "$ready_file" 2>/dev/null; then ready=1; break; fi
      kill -0 "$service_pid" 2>/dev/null || break
      sleep 1
    done
    [[ "$ready" == 1 ]] || { kill "$service_pid" 2>/dev/null || true; wait "$service_pid" 2>/dev/null || true; fail 'built email-service did not become ready'; }
    service_status=0
    wait "$service_pid" || service_status=$?
    service_ended_at=$(node -e 'process.stdout.write(new Date().toISOString())')
    export SERVICE_STARTED_AT="$service_started_at" SERVICE_ENDED_AT="$service_ended_at"
    [[ "$service_status" == 124 || "$service_status" == 0 ]] || fail "built email-service exited with status $service_status"
    curl --fail --silent --show-error --max-time 20 --config "$curl_config" \
      "$FIXTURE_API_BASE_URL/v1/runs/$EVIDENCE_RUN_ID/export" > "$run_dir/recipient-records.jsonl" \
      || fail 'fixture recipient export failed'
    chmod 600 "$ready_file" "$run_dir/recipient-records.jsonl"

    need PROVIDER_ID
    need EXPECTED_IMAP_HOST
    need EXPECTED_IMAP_PORT
    node --input-type=module - "$REPO/scripts/lib/public-email-service-evidence.mjs" "$run_dir" <<'NODE'
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [modulePath, dir] = process.argv.slice(2);
const { validatePublicEmailServiceEvidence } = await import(pathToFileURL(modulePath));
const reset = JSON.parse(fs.readFileSync(dir + '/reset-response.json', 'utf8'));
const input = {
  runId: process.env.EVIDENCE_RUN_ID,
  scenario: process.env.SCENARIO,
  readiness: JSON.parse(fs.readFileSync(`${dir}/readiness.json`, 'utf8')),
  runStartedAt: reset.startedAt,
  serviceStartedAt: process.env.SERVICE_STARTED_AT,
  serviceEndedAt: process.env.SERVICE_ENDED_AT,
  emailServiceLog: fs.readFileSync(`${dir}/email-service.log`, 'utf8'),
  recipientJsonl: fs.readFileSync(`${dir}/recipient-records.jsonl`, 'utf8'),
  providerId: process.env.PROVIDER_ID,
  expectedHost: process.env.EXPECTED_IMAP_HOST,
  expectedPort: process.env.EXPECTED_IMAP_PORT,
  expectedCredentialId: process.env.EXPECTED_CREDENTIAL_ID,
  expectedOAuthClientId: process.env.EXPECTED_OAUTH_CLIENT_ID,
  persistedState: JSON.parse(fs.readFileSync(dir + '/persisted-provider-state.json', 'utf8')),
  oldCredentialIds: (process.env.OLD_CREDENTIAL_IDS ?? '').split(',').filter(Boolean),
  originalCredentialId: process.env.ORIGINAL_CREDENTIAL_ID,
  minimumObservationSeconds: Number(process.env.MINIMUM_OBSERVATION_SECONDS || 0),
};
const result = validatePublicEmailServiceEvidence(input);
fs.writeFileSync(`${dir}/validation.json`, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
NODE
    node - "$run_dir/metadata.json" "$EFFECTIVE_SOURCE_REVISION" "$SCENARIO" "$run_started_at" "$service_started_at" "$service_ended_at" "$service_log" "$run_dir/recipient-records.jsonl" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const [out, revision, scenario, startedAt, serviceStartedAt, endedAt, serviceLog, recipientLog] = process.argv.slice(2);
const sha256 = (path) => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const metadata = {
  revision,
  runId: process.env.EVIDENCE_RUN_ID,
  scenario,
  startedAt,
  serviceStartedAt,
  endedAt,
  evidence: {
    emailServiceLog: { path: 'email-service.log', sha256: sha256(serviceLog) },
    recipientRecords: { path: 'recipient-records.jsonl', sha256: sha256(recipientLog) },
    readiness: { path: 'readiness.json', sha256: sha256(path.join(path.dirname(serviceLog), 'readiness.json')) },
    validation: { path: 'validation.json', sha256: sha256(path.join(path.dirname(serviceLog), 'validation.json')) },
    persistedProviderState: { path: 'persisted-provider-state.json', sha256: sha256(path.join(path.dirname(serviceLog), 'persisted-provider-state.json')) },
    runtimeBinding: { path: 'runtime-binding.json', sha256: sha256(path.join(path.dirname(serviceLog), 'runtime-binding.json')) },
  },
  secretsRedacted: true,
};
fs.writeFileSync(out, JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 });
NODE
    chmod 600 "$run_dir"/*.json "$service_log" "$run_dir/recipient-records.jsonl"
    rm -f "$fingerprint_key_file"
    ;;
  *) fail 'EVIDENCE_PHASE must be prepare or capture' ;;
esac
