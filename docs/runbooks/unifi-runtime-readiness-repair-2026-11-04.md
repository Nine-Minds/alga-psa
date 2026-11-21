# UniFi runtime readiness repair — 2026-11-04

## Scope and revision

This operational repair was performed against `03f6ef23b37ef3f0a1a03e8765fa3d98b89e6fd3` in the `feature/alga-2026-0002579-unifi-integration-alerts-devic` worktree. No product code was changed. The plan’s section 8 lifecycle and section 8.3 acceptance requirements were used; the original lifecycle mechanics are superseded there.

## Board managed application service

The durable `dev-server` service for project `9e04b851-07f4-4f95-96d1-7fa103ea4840` is saved with:

- working directory: `<worktree>/server`
- command: `PORT=3294 npm run dev`
- readiness: HTTP `/api/health` on port `3294`

It was started and restarted only through `/home/robert/.alga-xo/bin/alga-dev workflow-ensure-service` and `workflow-restart-service`. At final verification its service state was live/running, listener PID `621586` had cwd equal to the worktree’s `server` directory, and the card hostname returned HTTP 200 with `{"status":"ok","version":"1.0.0"}`. The review browser pane also loaded Settings → Integrations → UniFi and exercised the saved integration.

The initial app login could not persist a session because the PostgreSQL `app_user` role password differed from the established worktree secret. The role password was aligned to that already-configured secret using the PostgreSQL admin connection; the secret value is intentionally not recorded here. Direct PostgreSQL access on `127.0.0.1:5474` and the application PgBouncer route on `127.0.0.1:6472` then authenticated as `app_user` to database `server`. No database data or schema was changed by this credential repair.

## Runtime database migrations

The target was confirmed as database `server` in container `alga-psa-local-test-postgres-1`, reached by the app through PgBouncer at host port `6472` (direct PostgreSQL host port `5474`). This is separate from test databases. Before applying migrations, `rmm_integrations` and `rmm_alerts` existed, the lifecycle tables did not, and migration foreign-key prerequisites were present. Citus was not installed, so the migrations’ tenant-distribution branch was not applicable in this runtime.

Knex’s ordinary migration-directory validation refused to run because 138 historical ledger names are absent from this worktree and `origin/main`. No broad migration run was used. The three named migrations were applied with targeted `knex migrate:up` calls through the supported Knex configuration, disabling only migration-list validation for those named files:

| Migration | Batch |
|---|---:|
| `20261103120000_create_rmm_condition_lifecycle.cjs` | 1050 |
| `20261103130000_order_rmm_condition_delivery.cjs` | 1051 |
| `20261103140000_index_rmm_condition_alert_ownership.cjs` | 1052 |

The resulting state/outbox tables, tenant/integration foreign keys, composite primary keys, active-state and alert-ownership indexes, transition ordering index, alert lookup index, and pending-transition index were verified. Final ledger and index output is in `runtime-final.txt` under the evidence directory below.

## Registered worker and simulator

The registered `temporal-worker` is live from this worktree’s `ee/temporal-workflows` directory and uses `127.0.0.1:7594`, namespace `default`, and queue `tenant-workflows`. The worker was built from this revision with the package build script and its documented 8 GB heap; its startup logs showed the `tenant-workflows`, `alga-jobs`, and `sla-workflows` pollers running. A process scan found one worker Node process (PID `451817`) under the registered service’s process group; the other matching PID was its service-owned shell parent, not a duplicate worker.

Temporal responded `SERVING` at `127.0.0.1:7233` inside its container, and host port `127.0.0.1:7594` accepted connections. The board’s `temporal-dev` readiness probe targets a Tailscale host address while this service binds locally, so its board health probe reports a false negative despite local Temporal readiness. The registered simulator service was live on port `18794` and returned HTTP 200.

## Product acceptance exercised

Using the real application action, simulator, registered worker, and persistent runtime lifecycle/outbox/alert/ticket tables, the run verified:

- wrong API key rejection, valid reconnect, explicit Test Connection success, site discovery/mapping, full asset sync, and asset-linked device alerts while Branch asset auto-sync remained disabled;
- the existing connected Level.io integration settings page loaded after UniFi acceptance, with its group mapping and active-alert view present; no Level.io state was changed;
- a one-minute grace period, no early transition, duplicate check protection, a delivered trigger then delivered recovery in sequence, and a second outage with a distinct identity and ticket;
- simulator actions for missing devices, empty listing protection, uncertain `UPDATING` state, and a stale evidence timestamp resetting grace were part of the earlier walkthrough, but `runtime-final.txt` contains only final rows and cannot establish their intermediate condition/outbox/alert/ticket guards;
- maintenance-window suppression, followed by a disabled-window recheck that activated the same condition alert and created a ticket; recovery closed the untouched ticket;
- mapping removal and restoration behavior: while the condition fired, the state became `unmanaged` with its outage and ticket identity retained; fresh failing evidence after restoration resumed the original outage, while fresh healthy evidence after a second removal/restoration emitted recovery and closed the ticket.

The mapping UI’s `ClientPicker` has no clear/unmap option. To exercise this transition, only the Branch mapping’s `client_id` was temporarily set to `NULL` and restored through a tenant-scoped database fixture; the actual condition handling and all observations/recovery were then driven through the application action. This does not count as verification of a UI unmap control. The fixture was restored to the original Wonderland client mapping.

The first runtime evidence captured state/outbox/alert/ticket rows only at the end, so it did not by itself prove each intermediate missing, empty, uncertain, or partial-site guard. The earlier runtime simulator log records a site error response, but persistent runtime history has only Branch transitions; do not claim a second site triggered and recovered during that failure. The DB-backed acceptance runs below provide intermediate assertions for several guards. They are recorded separately from the real-app walkthrough and do not turn the earlier Branch-only runtime history into multi-site runtime evidence.

## DB-backed lifecycle verification (review follow-up)

Both requested suites passed on 2026-11-04 at source revision `03f6ef23b37ef3f0a1a03e8765fa3d98b89e6fd3`. Direct PostgreSQL was verified at `127.0.0.1:5474`; the test harness received `TEST_DB_NAME` before Vitest imported the suites and used unique databases `alga_unifi_lifecycle_verify_20261104` and `alga_unifi_pipeline_verify_20261104`. The EE run used a temporary merged CE+EE migration directory. Both isolated databases contain the three lifecycle migration ledger entries, state/outbox tables, and the expected ordering and ownership indexes. The runtime database `server` was not recreated or used as a test database.

| Suite | Result | Evidence |
|---|---:|---|
| `server/src/test/integration/rmmConditionLifecycle.integration.test.ts` | 1 file, 3 tests passed | `lifecycle-test-command.txt`, `lifecycle-test-output.txt` |
| `ee/server/src/__tests__/integration/rmmAlertPipeline.integration.test.ts` | 1 file, 27 tests passed | `pipeline-test-command.txt`, `pipeline-test-output.txt` |
| Isolated schema/ledger verification | Both databases contain all three migrations, lifecycle tables, and five expected indexes | `isolated-schema-verification.txt` |

The lifecycle DB suite fires an outage, acknowledges its transition, then checks uncertain evidence, missing evidence, and failed-scope evidence while preserving the same external alert identity and trusted-evidence time. The real UniFi adapter/pipeline DB suite checks empty inventories and a failed site while existing alerts remain active; it checks that the unaffected site can recover while the failed site's existing outage remains active. It does **not** assert a newly triggered and recovered second-site outage during the failed site's outage. It also checks an unmanaged/remapped state where uncertain evidence retains the outage identity and healthy evidence resolves it; the failing remap path holds the existing alert. The two actual-adapter deferred-trigger cases (`OFFLINE` and `ONLINE`) start with a pending outbox trigger, remove management, prove it stays pending with no alert/ticket, remap under `UPDATING` and prove it remains pending, then prove fresh OFFLINE resumes the same trigger exactly once under concurrent delivery while ONLINE supersedes it with recovery and no obsolete ticket. These cases exercise DB state/outbox and downstream alert/ticket rows, not screenshots.

The earlier runtime UI removal case began from an already-delivered outage and must not be read as a pending-trigger deferral. The pending-trigger distinction above is proven by the DB-backed actual-adapter tests.

## Follow-up runtime smoke boundary

The first follow-up attempt failed because its browser session had expired; its `AuthenticationError` and unchanged rows are retained in `runtime-smoke-followup.txt`. For round 3, the supported development-login recovery procedure was used. The private `server/.env.local` was set to mode 0600, recovery and a fresh-process verification both passed, and the temporary credential was rotated and re-verified after the smoke. The existing browser pane loaded this worktree's exact port 3294 hostname, signed in as the seeded internal user, and the **Check Offline Devices Now** server action returned HTTP 200 with “Offline check completed” before any simulator state was changed. The pane was signed out after testing. No credential value is in the evidence.

`runtime-round3-sql.txt` records timestamped before/during/after condition, outbox, alert, and linked ticket rows. At 08:50Z, the HQ gateway fired as outage `f37da029-a8ce-4fc8-8e13-3bff00bdea3f`, alert `condition:f37da029-a8ce-4fc8-8e13-3bff00bdea3f`, ticket `TIC001448`. Removing it from a still-nonempty HQ inventory produced `missing` at 08:50:46 and 08:50:48; setting HQ to empty produced `missing` at 08:51:19 and 08:51:21; restoring it as `UPDATING` produced `uncertain` at 08:52:05 and 08:52:07. Across these checks the state stayed firing and the outage, alert, and ticket identities stayed fixed; the delivered outbox retained only its original trigger. Setting the gateway ONLINE produced a delivered reset at 08:52:28, auto-resolved the alert, and closed `TIC001448`.

For the cross-site case, HQ fired at 08:54:15 with outage `a399bc05-4d03-4f74-ac12-a9d4944a21ac`, alert `condition:a399bc05-4d03-4f74-ac12-a9d4944a21ac`, and ticket `TIC001449`. HQ then returned HTTP 500 while Branch went offline. During the failed listing HQ stayed firing with `scope_unavailable` evidence and retained the same outage and ticket; Branch first entered grace, then triggered at 08:56:33 with ticket `TIC001450`. Branch recovery delivered at 08:57:03 and closed `TIC001450` while HQ remained unavailable and its outage/ticket stayed active. After HQ listing recovered, fresh failing evidence resumed the same HQ outage. Explicit healthy evidence delivered its reset at 08:57:54 and closed `TIC001449`.

The integration setting reports a 5-minute alert poll interval. Browser action times and SQL `last_observation_at`, transition `created_at`, and `delivered_at` are recorded together. The database does not identify whether a given reconciliation was initiated by a manual action or a scheduled poll, so the evidence attributes each transition to the observed evidence and does not claim a specific initiator. In particular, the final HQ healthy recovery was delivered at 08:57:54Z, near a nominal five-minute boundary. No scheduled poll is inferred from a screenshot or final rows alone.

For ticket routing, the saved acceptance rule originally matched `router`, while the HQ simulator gateway emitted alert class `firewall`. The rule was temporarily widened to match both classes, then restored to the original router-only JSON. The mappings were not changed. Final audit shows both sites healthy, zero pending transitions, mappings restored, and `TIC001448`–`TIC001450` closed. The simulator returned to normal mode with all four HQ devices and the Branch gateway online. Read `runtime-authenticated-actions.txt`, `runtime-round3-sql.txt`, `runtime-round3-final-audit.txt`, the per-action simulator JSON files, and `simulator-round3-restored.json` together.

This runtime unmapping work is distinct from pending-trigger deferral. The runtime mapping test began with an already-delivered outage. Genuine pending trigger retention, uncertain remapping, fresh failing resume, healthy supersession, and concurrent delivery are established by the successful actual-adapter DB regressions above, not by the runtime mapping action. Live UniFi Site Manager/controller semantics remain unverified by the local simulator.

The final simulator state is normal with both sites and devices online; the integration is reconnected, the original mappings are restored, the Branch asset-sync setting remains disabled, and the temporary maintenance window is inactive. The final Branch condition is healthy and all lifecycle transitions are delivered. Existing legacy alert and ticket history remains present with its original links.

The local simulator does not establish live UniFi Site Manager/controller semantics. Those require a separate live-controller validation.

## Evidence

Review artifacts are under `/home/robert/.alga-xo/reviews/unifi-integration-3711/evidence/repair-20261104/`:

- `01-integrations-baseline.png` through `10-levelio-regression.png`: application checkpoints, including rejected credentials, connection validation, mapping/device sync, rule configuration, the final connected state, and the Level.io regression page.
- `baseline-db.txt` and `runtime-final.txt`: database baselines, migration ledger/index definitions, persistent condition states, ordered outbox, alert/ticket linkage, and maintenance suppression/recheck. These are final snapshots and do not establish intermediate guard behavior.
- `lifecycle-test-command.txt`, `lifecycle-test-output.txt`, `pipeline-test-command.txt`, and `pipeline-test-output.txt`: exact isolated test commands and sanitized complete results.
- `isolated-schema-verification.txt`: lifecycle ledger entries, tables, and indexes in both disposable test databases.
- `runtime-smoke-followup.txt`: failed authenticated runtime attempt and unchanged persistent rows.
- `runtime-authenticated-actions.txt`, `runtime-round3-sql.txt`, and `runtime-round3-final-audit.txt`: round 3 authentication/action proof, timestamped runtime phase queries, and restored final state.
- `main-*.json`, `partial-*.json`, and `simulator-round3-restored.json`: simulator changes/restoration responses and final inventory.
- `simulator-baseline.json`: initial simulator inventory.

## Checks and remaining limitations

- Passed: 1,077 `packages/integrations` tests; 84 focused current-revision UniFi and Level.io unit tests; `packages/integrations` and `ee/server` TypeScript checks; `server` TypeScript check; Temporal worker build; enterprise server build (`npm run build:enterprise`, exit 0).
- `packages/integrations`’ standalone `build` script is not runnable as configured: `tsup` reports no input files. The enterprise application build is the product build check.
- Both RMM DB-backed suites passed on the migrated isolated schema as recorded above. The pipeline run emitted Redis event-bus connection warnings (`127.0.0.1:6379` refused); ticket and lifecycle assertions still passed. No test connected to or dropped the runtime `server` database.
- The Level.io regression check covered the existing settings page and focused Level.io unit tests; no Level.io alert was generated in this run.
- Live-controller validation and a UI-driven mapping removal remain unverified. Runtime pending-trigger deferral remains DB-test coverage; the runtime unmap began from an already-delivered outage.

