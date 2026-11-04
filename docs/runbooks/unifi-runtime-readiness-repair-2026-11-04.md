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
- missing devices, empty listing protection, uncertain `UPDATING` state, and a stale evidence timestamp resetting the grace period;
- one site returning HTTP 500 while the other site continued through trigger and recovery;
- maintenance-window suppression, followed by a disabled-window recheck that activated the same condition alert and created a ticket; recovery closed the untouched ticket;
- mapping removal and restoration behavior: while the condition fired, the state became `unmanaged` with its outage and ticket identity retained; fresh failing evidence after restoration resumed the original outage, while fresh healthy evidence after a second removal/restoration emitted recovery and closed the ticket.

The mapping UI’s `ClientPicker` has no clear/unmap option. To exercise this transition, only the Branch mapping’s `client_id` was temporarily set to `NULL` and restored through a tenant-scoped database fixture; the actual condition handling and all observations/recovery were then driven through the application action. This does not count as verification of a UI unmap control. The fixture was restored to the original Wonderland client mapping.

The final simulator state is normal with both sites and devices online; the integration is reconnected, the original mappings are restored, the Branch asset-sync setting remains disabled, and the temporary maintenance window is inactive. The final Branch condition is healthy and all lifecycle transitions are delivered. Existing legacy alert and ticket history remains present with its original links.

The local simulator does not establish live UniFi Site Manager/controller semantics. Those require a separate live-controller validation.

## Evidence

Review artifacts are under `/home/robert/.alga-xo/reviews/unifi-integration-3711/evidence/repair-20261104/`:

- `01-integrations-baseline.png` through `10-levelio-regression.png`: application checkpoints, including rejected credentials, connection validation, mapping/device sync, rule configuration, the final connected state, and the Level.io regression page.
- `baseline-db.txt` and `runtime-final.txt`: database baselines, migration ledger/index definitions, persistent condition states, ordered outbox, alert/ticket linkage, and maintenance suppression/recheck.
- `simulator-baseline.json`: initial simulator inventory.

## Checks and remaining limitations

- Passed: 1,077 `packages/integrations` tests; 84 focused current-revision UniFi and Level.io unit tests; `packages/integrations` and `ee/server` TypeScript checks; `server` TypeScript check; Temporal worker build; enterprise server build (`npm run build:enterprise`, exit 0).
- `packages/integrations`’ standalone `build` script is not runnable as configured: `tsup` reports no input files. The enterprise application build is the product build check.
- The RMM pipeline integration suite did not reach its tests: its default DB port had no listener, and the shared currency test server uses different admin credentials. A disposable PostgreSQL retry also failed in the existing harness during role/database recreation, so the lifecycle database integration suite is not green from this run. No test attempted to connect to or drop the runtime `server` database.
- The Level.io regression check covered the existing settings page and focused Level.io unit tests; no Level.io alert was generated in this run.
- Live-controller validation and a UI-driven mapping removal remain unverified.

