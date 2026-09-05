# Accounting provider simulator (QBO + Xero)

A reusable local fake-provider for smoke-testing the **real** QuickBooks
Online and Xero OAuth + disconnect lifecycle in the Alga PSA app. It speaks the
vendors' wire shapes and lets the app complete callbacks, token exchanges, and
disconnect revocation through its actual routes, state/PKCE/session handling,
and secret storage — it never bypasses app logic, and it never weakens the
disconnect gating under test (callbacks landing mid-disconnect are still
rejected by the app).

- `accounting-provider-simulator.cjs` — the simulator server.
- Committed for reuse; nothing here is a throwaway patch.

## Start the simulator

```bash
node tools/smoke-sim/accounting-provider-simulator.cjs
# listens on http://127.0.0.1:4901
```

Overrides: `ALGA_ACCOUNTING_SIM_PORT`, `ALGA_ACCOUNTING_SIM_CONTROL`
(control file path, default `/tmp/alga-accounting-sim-control.json`),
`ALGA_ACCOUNTING_SIM_CALLS` (request log, default
`/tmp/alga-accounting-sim-calls.jsonl`).

## Point the app at it (dev-only env)

Append to `server/.env.local`, then restart the dev server:

```
QBO_OAUTH_AUTHORIZE_URL=http://127.0.0.1:4901/qbo/connect/oauth2
QBO_OAUTH_TOKEN_URL=http://127.0.0.1:4901/qbo/oauth2/v1/tokens/bearer
QBO_OAUTH_REVOKE_URL=http://127.0.0.1:4901/qbo/oauth2/v1/revoke
QBO_API_BASE_URL=http://127.0.0.1:4901/qbo/v3/company
XERO_OAUTH_AUTHORIZE_URL=http://127.0.0.1:4901/xero/connect/authorize
XERO_OAUTH_TOKEN_URL=http://127.0.0.1:4901/xero/connect/token
XERO_CONNECTIONS_URL=http://127.0.0.1:4901/xero/connections
XERO_REVOCATION_URL=http://127.0.0.1:4901/xero/connect/revocation
XERO_API_BASE_URL=http://127.0.0.1:4901/xero/api.xro/2.0
```

Unset every one of these for any non-test deployment — the app then targets the
real vendor hosts (they are the defaults). No simulator URL is a default.

## Connect a provider (repro)

1. UI → Settings → Integrations → Accounting. Save the provider client
   id/secret (any value; the simulator does not validate them).
2. Click **Connect**. The browser lands on the simulator's authorize endpoint,
   which 302s straight back to the app callback with a code.
3. The app's callback validates state / PKCE / session, exchanges the code at
   the simulator's token endpoint, and persists the simulated realm/connections
   through the normal storage path. The UI shows the provider as connected.

For QBO the simulator returns realm `smoke-realm-a` (control key
`qbo_realm_id`). For Xero it returns two tenant connections by default
(`smoke-conn-a`, `smoke-conn-b`); override via the `xero_connections` control
array.

## Drive the disconnect lifecycle

The UI's **Disconnect**, **Retry Disconnect**, and **Force Finalize** buttons
drive the state machine directly — that is the primary path (same server action
the scheduled retry job uses). To run an extra pass server-side (e.g. to retry
a pending record without waiting for backoff, or to force-finalize), use the
included driver, which calls the same service:

```bash
cd <worktree-root>
export $(grep -v '^#' server/.env.local | grep -E '^[A-Z_]+=' | xargs)
npx tsx tools/smoke-sim/accounting-disconnect-driver.cts <tenantId> quickbooks_online pass
npx tsx tools/smoke-sim/accounting-disconnect-driver.cts <tenantId> xero force "reason recorded in audit"
```

### Outcome modes

Flip a mode in the control file (or `POST /control`) and the **next** request
uses it — no restart:

```bash
curl -X POST http://127.0.0.1:4901/control -H 'content-type: application/json' \
  -d '{"qbo_revoke":"transient"}'
curl http://127.0.0.1:4901/control          # current control
curl -X DELETE http://127.0.0.1:4901/control # reset + clear runtime state
```

| Mode | Effect | App behavior under test |
| --- | --- | --- |
| `success` | normal vendor response | revoke → finalized |
| `transient` | 503 | stays `pending_revocation`, retryable |
| `permanent` | 401 `invalid_client` | `failed_permanent`, force-finalize surfaced |
| `timeout` | response after `timeout_ms` (default 30s, past the app's axios timeout) | transient timeout, stays pending |
| `repeat` | vendor "already done" (400 `invalid_grant` / 404) | idempotent success / repeat no-op |

For an in-flight-callback race (a callback issued before a disconnect lands while
the disconnect is active), set `qbo_authorize`/`xero_authorize` to `timeout` and
raise `timeout_ms` (e.g. `90000`): the browser parks on the provider authorize
holding the valid OAuth state cookie while you start the disconnect, then the
delayed redirect delivers the stale callback — which the app must reject.

Per-target (multi-realm / multi-tenant partial):

```json
{
  "qbo_revokes": { "smoke-realm-a": "success", "smoke-realm-b": "permanent" },
  "xero_delete_connections": { "smoke-conn-a": "success", "smoke-conn-b": "transient" }
}
```

### What's simulated vs. real

- Real (app): callback routes, signed QBO state + CSRF/PKCE cookies, session
  tenant binding, token exchange parsing, secret storage, tombstoning, the
  bounded-retry disconnect state machine, finalize ordering (tombstone
  deletion before `finalized`), force-finalize.
- Simulated (this server): the providers' HTTP surfaces — QBO authorize /
  token / revoke; Xero authorize / token / connections (GET + DELETE) / OAuth
  revocation — plus injected fault modes for those endpoints.
