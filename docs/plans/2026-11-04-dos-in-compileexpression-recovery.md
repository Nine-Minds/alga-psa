# Expression DoS: recovery investigation

PR: https://github.com/Nine-Minds/alga-psa/pull/4191

Application revision inspected and tested: `8ccf168fb001b07de3208a35d1b5365d40484a73`.
Design: [compileExpression DoS design](2026-11-03-dos-in-compileexpression-design.md).

## Result

The deterministic expression-budget implementation remains in place. No new
expression-engine or authentication defect was established. Fresh local tests
pass, but live recovery is incomplete: host memory pressure killed the existing
board-managed application server during browser verification. Do not treat this
report as a successful smoke run or a `security-finding-resolved` gate result.

No application server was started or restarted by this investigation. No shared
workloads, admission thresholds, authentication checks, or expression limits were
changed.

## Authentication and navigation evidence

The successful 03:02Z smoke and failed 11:30Z smoke both tested the application
revision above. Their evidence directories are under
`/tmp/alga-smoke-evidence/security-dos-compileexpression-20261104T0302Z` and
`/tmp/alga-smoke-evidence/security-dos-compileexpression-20261104T1130Z`.

The latter's `session-final.json` contains an empty session. Its README retracts
the earlier interpretation that a successful credentials-endpoint response proved
authentication. Its console records repeated HMR connections and Fast Refresh
events, but does not identify what initiated document navigation.

The archived server log adds 17,617 `durable_session_revoked` rejections. The
read-only QA session query found five unrevoked sessions created between 11:35Z
and 11:42Z, plus older sessions revoked with reason `max_sessions`. The failed
browser's session identifier was not captured, so these records do not prove
which session it used or why its inputs reset.

Relevant code paths:

- `packages/auth/src/components/MspLoginForm.tsx`: password state changes through
  the input handler; successful submission persists the remembered email and
  navigates to the returned URL. There is no periodic reload in this component.
- `packages/auth/src/lib/getSession.ts`: `requireLiveSession` logs the durable
  rejection reason and denies rejected sessions.
- `packages/db/src/models/UserSession.ts`: `getRejectionReason` rejects revoked
  rows; `enforceMaxSessions` revokes older sessions. Keep those checks intact.
- `packages/auth/src/lib/nextAuthOptions.ts`: initial sign-in creates a tracked
  session; subsequent JWT processing checks it before returning the token.
- `server/src/middleware.ts`: unauthenticated MSP requests redirect to sign-in;
  development requests with a session cookie can defer validation to Node.

Board browser commands timed out on both the inherited and fallback sockets.
An isolated Puppeteer browser then loaded the real card origin and retained the
QA email and all 14 password characters after four seconds. A second attempt
also retained its inputs. This did not reproduce the repeated input resets.
Form submission did not reach a verified authenticated session or designer.
The retry recorded `chrome-error://chromewebdata/` at 12:05:50.413Z, immediately
after the server termination below. A successful login is **not** claimed.

## Host recovery and memory evidence

Board service `dev-server:6` had recovered externally at
`2026-11-04T11:54:13.584Z`. PID 2364957 listened on 3360 with this worktree's
`server/` as its working directory. The listener and process were checked directly.

At **12:05:49Z**, the user journal records:

```text
alga-card-card-service_c46829b6-e5f7-5e83-bc1b-d46df4d73ce8_dev-server_6-mw226sq0.scope:
systemd-oomd killed 8 process(es) in this unit.
```

The following journal entry reports a **2.4G memory peak** for that service.
Afterward, PID 2364957 was absent and port 3360 had no listener. The board still
returned a cached `running` health result from 11:59:41Z. Journal entries also
recorded JetStream state unavailability during health checks. A cached board
status is insufficient evidence of current readiness.

The local admission-ledger replica recorded a memory-pressure latch from
12:02:28Z and a 3 GiB reservation for this implementation run. The supported CLI
help advertised `workflow-resource-holds`, but both socket routes returned
`Unknown workflow command`; the replica is evidence, not an authoritative fresh
admission calculation. No stale reservation was proven safe to release.

The full server typecheck started with approximately 21 GiB available and later
used over 8 GiB RSS while other host workloads continued running. Available
memory fell to roughly 6 GiB, with swap full. The typecheck was terminated to
reduce pressure after the service died; it did not pass. Its contribution to
pressure must be included when planning the next verification window. Do not
attribute the OOM solely to the application server or an expression evaluation.
No live range-bomb request was issued during this investigation.

## Local verification

All commands ran against the application revision above without starting an app
server. Test commands used `--coverage.enabled=false --maxWorkers=1`.

| Check | Result |
| --- | --- |
| Shared expression engine, publication validation, simulator, condition model, conformance, authoring guide | 283 tests passed |
| Server workflow runtime and inbound mapping/idempotency | 43 tests passed |
| Temporal run-workflow and simulator-contract, using `vitest.no-docker.config.ts` | 47 tests passed |
| `shared`: `npm run typecheck` | Passed |
| `shared`: `npm run build` | Passed |
| `ee/temporal-workflows`: `npm run build` | Passed |
| `server`: `NODE_OPTIONS=--max-old-space-size=12288 npm run typecheck` | Interrupted for host memory pressure; exit 143 |

An initial broader shared invocation passed 289 tests but failed to load
`designer/__tests__/draftFromTicket.test.ts`: the shared test alias maps
`@alga-psa/db/tenantDb` to the nonexistent `packages/db/src/tenantDb`, while the
source lives at `packages/db/src/lib/tenantDb.ts`. That unrelated configuration
was left unchanged. The focused six-suite invocation above completed cleanly.

The original merged engine was also read at `af2f92895d8b`: it checked elapsed
time only after evaluation. The approved replacement uses JSONata evaluation
hooks, bounded range construction, and per-invocation budgets shared across
frames. Publication validation, draft simulation, and Temporal still use that
engine. The regression tests exercise real evaluation and controlled failures,
including subsequent successful evaluations. The obsolete timeout was not restored.

## Evidence and remaining verification

Takeover artifacts are preserved on this host at:

`/home/robert/.alga-xo/reviews/security-dos-compileexpression-4191/evidence/takeover-20261104T1154Z/`

Start with `service-oom.log`, `login-retry-result.json`, `admission-ledger.json`,
and the test/build logs. The full service logs are at
`/home/robert/.alga-dev/card-services/card-service_c46829b6-e5f7-5e83-bc1b-d46df4d73ce8_dev-server_6/service.log`
and `service.log.1`.

The board/host owner must provide a memory-admitted recovery and verification
window. Reserve for the server typecheck's actual memory demand separately from
the dev server, or run them serially with sufficient headroom. Restore service
through board management, then verify the listener and an HTTP response rather
than relying on cached health. Repair board command routing and state availability
if those remain unavailable; do not bypass admission or disable OOM protection.

After recovery:

1. Finish server typecheck in the admitted window.
2. At `http://feature-security-dos-in-compileexpression.localhost:3360`, verify
   stable form inputs, QA sign-in, a user in `/api/auth/session`, and the designer.
   Capture document navigation initiators and rejected-session identifiers if
   the old symptoms recur; do not expose session-token values.
3. Rerun normal conditions, range-bomb publication rejection, dynamic aggregate
   ranges, execution budgets, and successful simulation/publish after failures.
4. Inspect the existing smoke workflow
   `cb389529-8959-4c67-b12a-064ecc5474bf`, last verified as safe published v2 with
   no triggers or actions. This investigation did not modify it.

Fresh live feature smoke, live Temporal/inbound delivery, and the external
security gate remain unverified. The historical 03:02Z smoke does not replace
these checks.
