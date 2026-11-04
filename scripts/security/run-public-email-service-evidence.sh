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
[[ "$FIXTURE_API_BASE_URL" == https://* ]] || fail 'fixture management API must use HTTPS'
[[ -r "$FIXTURE_ADMIN_TOKEN_FILE" ]] || fail 'fixture admin token file is not readable'
mode=$(stat -c '%a' "$FIXTURE_ADMIN_TOKEN_FILE")
[[ "$mode" == 600 || "$mode" == 400 ]] || fail 'fixture admin token file must have mode 600 or 400'
[[ "$FIXTURE_ADMIN_TOKEN_FILE" != "$REPO"/* ]] || fail 'fixture admin token must remain outside the repository'

run_dir="$PRIVATE/evidence-runs/$EVIDENCE_RUN_ID"
mkdir -p "$PRIVATE/evidence-runs"
chmod 700 "$PRIVATE/evidence-runs"
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
if (value.runId !== process.argv[3] || value.scenario !== process.argv[4] || typeof value.startedAt !== 'string') {
  throw new Error('fixture reset response does not identify the requested run and scenario');
}
NODE
    printf 'Fixture reset for %s (%s). Run the real UI scenario, then capture with EVIDENCE_PHASE=capture.\n' "$EVIDENCE_RUN_ID" "$SCENARIO"
    ;;
  capture)
    [[ -d "$run_dir" && -f "$run_dir/reset-response.json" ]] || fail 'run must be prepared before capture'
    need EMAIL_SERVICE_ENV_FILE
    need PROVIDER_ID
    need EXPECTED_IMAP_HOST
    need EXPECTED_IMAP_PORT
    need EXPECTED_CREDENTIAL_ID
    need PUBLIC_IMAP_ORIGINAL_HOST
    need PUBLIC_IMAP_REPLACEMENT_HOST
    need PUBLIC_IMAP_PORT
    need PUBLIC_OAUTH_TOKEN_URL
    if [[ "$SCENARIO" == oauth-baseline || "$SCENARIO" == oauth-reconnect || "$SCENARIO" == oauth-refresh ]]; then need EXPECTED_OAUTH_CLIENT_ID; fi
    if [[ "$SCENARIO" == scope-change ]]; then need OLD_CREDENTIAL_IDS; fi
    [[ -r "$EMAIL_SERVICE_ENV_FILE" ]] || fail 'EMAIL_SERVICE_ENV_FILE is not readable'
    mode=$(stat -c '%a' "$EMAIL_SERVICE_ENV_FILE")
    [[ "$mode" == 600 || "$mode" == 400 ]] || fail 'service env file must have mode 600 or 400'
    [[ "$EMAIL_SERVICE_ENV_FILE" != "$REPO"/* ]] || fail 'service env file must remain outside the repository'
    set -a
    # shellcheck disable=SC1090
    source "$EMAIL_SERVICE_ENV_FILE"
    set +a
    need DB_NAME_SERVER
    need SECRET_FS_BASE_PATH
    [[ "$DB_NAME_SERVER" == smoke_imap_public_* ]] || fail 'DB_NAME_SERVER must start smoke_imap_public_'
    [[ "$SECRET_FS_BASE_PATH" != "$REPO"/* && -d "$SECRET_FS_BASE_PATH" ]] || fail 'secret filesystem must exist outside the repository'
    [[ -f "$REPO/services/email-service/dist/services/email-service/src/index.js" ]] || fail 'production email-service build is missing'
    export PUBLIC_IMAP_ORIGINAL_HOST PUBLIC_IMAP_REPLACEMENT_HOST PUBLIC_IMAP_PORT PUBLIC_OAUTH_TOKEN_URL
    (cd "$REPO" && "$REPO/node_modules/.bin/tsx" -e 'import { assertSafeOutboundHost, assertSafeOutboundUrl } from "./shared/services/net/outboundAddressPolicy.ts"; (async () => { await assertSafeOutboundHost(process.env.PUBLIC_IMAP_ORIGINAL_HOST!); await assertSafeOutboundHost(process.env.PUBLIC_IMAP_REPLACEMENT_HOST!); await assertSafeOutboundUrl(process.env.PUBLIC_OAUTH_TOKEN_URL!); })().catch((e) => { console.error(`public fixture destination rejected: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });')
    for host in "$PUBLIC_IMAP_ORIGINAL_HOST" "$PUBLIC_IMAP_REPLACEMENT_HOST"; do
      timeout 15s openssl s_client -connect "$host:$PUBLIC_IMAP_PORT" -servername "$host" -verify_hostname "$host" -verify_return_error </dev/null >/dev/null 2>&1 || fail "trusted IMAPS TLS validation failed for $host"
    done
    tls_result=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{ssl_verify_result}' "$PUBLIC_OAUTH_TOKEN_URL") || fail 'OAuth HTTPS endpoint TLS connection failed'
    [[ "$tls_result" == 0 ]] || fail "OAuth HTTPS certificate validation failed (curl ssl_verify_result=$tls_result)"

    service_log="$run_dir/email-service.log"
    ready_file="$run_dir/readiness.json"
    service_started_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
    PORT=${EMAIL_SERVICE_EVIDENCE_PORT:-23958} EVIDENCE_RUN_ID="$EVIDENCE_RUN_ID" \
      NODE_ENV=production timeout --signal=TERM --kill-after=15s "${EMAIL_SERVICE_RUN_SECONDS:-120}s" \
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
    service_ended_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
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
const input = {
  runId: process.env.EVIDENCE_RUN_ID,
  scenario: process.env.SCENARIO,
  readiness: JSON.parse(fs.readFileSync(`${dir}/readiness.json`, 'utf8')),
  serviceStartedAt: process.env.SERVICE_STARTED_AT,
  serviceEndedAt: process.env.SERVICE_ENDED_AT,
  emailServiceLog: fs.readFileSync(`${dir}/email-service.log`, 'utf8'),
  recipientJsonl: fs.readFileSync(`${dir}/recipient-records.jsonl`, 'utf8'),
  providerId: process.env.PROVIDER_ID,
  expectedHost: process.env.EXPECTED_IMAP_HOST,
  expectedPort: process.env.EXPECTED_IMAP_PORT,
  expectedCredentialId: process.env.EXPECTED_CREDENTIAL_ID,
  expectedOAuthClientId: process.env.EXPECTED_OAUTH_CLIENT_ID,
  credentialGeneration: process.env.EXPECTED_CREDENTIAL_GENERATION,
  oldCredentialIds: (process.env.OLD_CREDENTIAL_IDS ?? '').split(',').filter(Boolean),
};
const result = validatePublicEmailServiceEvidence(input);
fs.writeFileSync(`${dir}/validation.json`, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
NODE
    node - "$run_dir/metadata.json" "$EFFECTIVE_SOURCE_REVISION" "$SCENARIO" "$service_started_at" "$service_ended_at" "$service_log" "$run_dir/recipient-records.jsonl" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const [out, revision, scenario, startedAt, endedAt, serviceLog, recipientLog] = process.argv.slice(2);
const sha256 = (path) => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const metadata = {
  revision,
  runId: process.env.EVIDENCE_RUN_ID,
  scenario,
  startedAt,
  endedAt,
  evidence: {
    emailServiceLog: { path: 'email-service.log', sha256: sha256(serviceLog) },
    recipientRecords: { path: 'recipient-records.jsonl', sha256: sha256(recipientLog) },
    readiness: { path: 'readiness.json', sha256: sha256(path.join(path.dirname(serviceLog), 'readiness.json')) },
    validation: { path: 'validation.json', sha256: sha256(path.join(path.dirname(serviceLog), 'validation.json')) },
  },
  secretsRedacted: true,
};
fs.writeFileSync(out, JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 });
NODE
    chmod 600 "$run_dir"/*.json "$service_log" "$run_dir/recipient-records.jsonl"
    ;;
  *) fail 'EVIDENCE_PHASE must be prepare or capture' ;;
esac
