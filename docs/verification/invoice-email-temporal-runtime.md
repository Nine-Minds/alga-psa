# Invoice email Temporal runtime verification

Use this runbook to connect a board-managed Alga PSA worktree and its built Temporal worker to a reachable local Temporal server. Keep the app and worker in board services. Do not launch a separate app server.

The worker registers `invoice_email` by forwarding it over the event bus to the app's `MaintenanceJobSubscriber`. The app executes `InvoiceEmailHandler`, generates the PDF, and sends the email. Both processes must use the same database and Redis configuration. Worker health and Temporal workflow completion alone do not prove that the app executed the handler or delivered the message.

## Prerequisites

- The current workflow step declares the `dev-server` service in its `services` list. The board automatically suspends that service when the current step does not use it. In the Alga Task Office workflow, `Smoke Test` declares the app service; `Draft Implementation` does not.
- The worktree's supporting database and GreenMail services are running, and the app's configured email provider routes outbound messages to that GreenMail instance.
- `server/.env.local` and `secrets/alga_auth_key` exist in the worktree. Do not copy their contents into service commands, logs, or this document.
- The retained `dev-server:14` log confirms initialization failed because `credential_encryption_key` was absent. The intended source is the configured secret provider, normally `secrets/credential_encryption_key` or the equivalent legitimate environment secret. There is no fallback to `NEXTAUTH_SECRET` for credential-vault encryption. Before Smoke Test, provision the existing environment key through the board service's supported secret source and confirm initialization succeeds. Do not generate a replacement for a database that may contain encrypted credentials.
- The resend event was published to the shared default Redis prefix and `event-processors` consumer group. Read-only inspection found 1,088 consumers in that group, the stream's last-delivered ID matching the resend event, and no pending delivery. Redis consumer groups distribute each event to one consumer; the target app service had no `InvoiceEmailHandler` execution log. For Smoke Test, set a worktree-unique `REDIS_PREFIX` (for example `alga-psa:cf07b4d9-invoice-email:`) consistently for the app and worker services so their streams and consumer group are isolated from other worktrees sharing Redis. This is environment configuration; do not change the existing board services while Draft Implementation is active.
- Draft Implementation confirmed that the current checked-in worker source registers `invoice_email` through the forward-and-wait path, but the captured `07:23:28 UTC` worker run completed immediately after publication and its job metadata had no `serverExecution` outcome. Treat the running built worker as stale: rebuild `ee/temporal-workflows`, then restart the existing `temporal-worker` board service during Smoke Test so it loads the completion-wait implementation. A source build or healthy old worker does not verify the runtime path.
- `server/.env.local:35` now contains `REDIS_PREFIX=alga-psa:cf07b4d9-invoice-email:`. The app and worker commands both source that file. `REDIS_PREFIX` prefixes event stream keys (`<prefix>event-stream:...`) and related prefixed keys; the group name remains `event-processors`. Confirm the service environments use the same Redis URL, prefix, and database settings in Smoke Test. This worktree still has no `secrets/credential_encryption_key`; provision the existing key from the configured authoritative provider without generating or substituting one.
- Forwarded execution state is persisted per Temporal run: `queued` can be atomically claimed as `processing`, and only that claim may invoke the handler. Redelivery while `processing`, or after `completed`/`failed`, is acknowledged without rerunning it. A waiter timeout conditionally marks the still-queued/processing run `failed` with an explicit “delivery outcome unknown” error. Both timeout/outcome writes and handler progress writes lock and merge the job row, so progress cannot erase the execution outcome; forwarded handlers also cannot change `jobs.status`, which remains workflow-owned. Thus late progress or completion cannot replace a workflow-recorded failure. This is intentionally not auto-reclaimed because SMTP may have accepted the message before the app lost its connection or crashed. Resolve that indeterminate run and, if a resend is needed, create a new explicit resend job; do not retry the same run as a new email attempt. A new execution cannot replace an actively processing one; a later explicit run can supersede a terminal outcome.
- The chosen app, Temporal, and worker health ports are free on the board service host.

## Build the worker

From the worktree root, build the storage dependency and Temporal worker:

```sh
cd packages/storage && npm run build
cd ../../ee/temporal-workflows && npm run build
```

The worker loads workspace packages from their `dist/` output. Rebuild a missing package before starting the worker.

## Start or inspect Temporal

The invoice email app and worker must use the same address, namespace, and task queue. This worktree used Temporal CLI 1.9.1 / server 1.32.0 in development mode on host port 17320, namespace `default`, and queue `alga-jobs`.

The board-managed Temporal server command was:

```sh
/snap/bin/docker run --rm --name cf07b4d9-invoice-temporal \
  -p 127.0.0.1:17320:7233 temporalio/temporal:latest \
  server start-dev --ip 0.0.0.0 --port 7233
```

Use `alga-dev workflow-ensure-service --projectId=<card-id> --name=temporal-server --command='<command>' --cwd=<worktree>` to create or inspect the board service. Check `alga-dev workflow-list-services --projectId=<card-id> --live=true --health=true` before using it. A listening TCP port alone does not prove Temporal is ready.

## Start the built worker as a board service

Use a free dedicated `HEALTH_CHECK_PORT`. Port 8080 belongs to the stack's GreenMail API, and 18080 belongs to another GreenMail instance on this host. Both caused worker health-server bind failures; 28081 was available and returned healthy. From `ee/temporal-workflows`, the working command was:

```sh
set -a
. ../../server/.env.local
set +a
export ALGA_AUTH_KEY="$(cat ../../secrets/alga_auth_key)"
export TEMPORAL_ADDRESS=127.0.0.1:17320
export TEMPORAL_NAMESPACE=default
export TEMPORAL_TASK_QUEUE=alga-jobs
export TEMPORAL_TASK_QUEUES=alga-jobs
export NODE_ENV=development
export HEALTH_CHECK_PORT=28081
node dist/ee/temporal-workflows/src/worker.js
```

Start it through `alga-dev workflow-ensure-service --projectId=<card-id> --name=temporal-worker --cwd=<worktree>/ee/temporal-workflows --command='<command>'`. Confirm the service's live health, `curl -fsS http://127.0.0.1:28081/health`, and worker logs. The worker must report `invoice_email` registration and poll `alga-jobs`; this build also polls `sla-workflows`.

## Start the app through its board service

Set the app environment to the same Temporal endpoint, namespace, and queue. The app uses `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and `TEMPORAL_JOB_TASK_QUEUE`; the worker uses `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and `TEMPORAL_TASK_QUEUE`.

After the current board step permits the service, start the app from the worktree's `server` directory using the repository dev entry point:

```sh
set -a
. ./.env.local
set +a
export ALGA_AUTH_KEY="$(cat ../secrets/alga_auth_key)"
export TEMPORAL_ADDRESS=127.0.0.1:17320
export TEMPORAL_NAMESPACE=default
export TEMPORAL_JOB_TASK_QUEUE=alga-jobs
export PORT=3811
export HOSTNAME=0.0.0.0
export NODE_OPTIONS=--max-old-space-size=8192
NX_LOAD_DOT_ENV_FILES=false NODE_ENV=development NEXT_DIST_DIR=.next-dev npx tsx dev-server.ts
```

Run that command only as the board-managed `dev-server` service, with its configured readiness probe and after required workspace dependencies are built. Do not restart the service to work around an automatic suspension. Enter the workflow step whose prompt uses the app, then ensure the service through the board.

If all previous `dev-server` records are concluded, supply `--command` and `--cwd` when ensuring the service. A concluded record does not provide a live service to resume. Use the command above rather than restoring an older launch that omits the reachable Temporal endpoint. Confirm the app logs `[MaintenanceJobSubscriber] Registered` before testing delivery.

## Verify delivery and authorization

After Smoke Test is the active board step, provision the legitimate credential key and apply the same worktree-unique `REDIS_PREFIX` to the app and worker board services. Then complete these authenticated checks:

1. Resend owned invoice `SMOKE-AUTHZ-1102` from the portal.
2. Correlate its new job with `MAINTENANCE_JOB_REQUESTED` consumption and matching-execution `InvoiceEmailHandler` completion.
3. Verify a new invoice sending log and an actual GreenMail message whose MIME attachment contains the invoice PDF.
4. Rerun scheduler denial and allowance through authenticated entry points: deny an internal user with `billing:create` and `billing:read` but without `invoice:send`, then allow with `invoice:send`.
5. Rerun immediate-send authorization parity and linked-internal portal resend rejection before enqueue or delivery.
6. Reload the UI repeatedly and verify the invoice menu opens and accepts recorded interactions each time.

Do not replace these checks with direct job enqueue calls or fixture-only tests. These authenticated checks and GreenMail PDF delivery remain unverified until Smoke Test.

## Local compile baseline

The Draft Implementation comparison used detached `main` at `fb68670732` with the same workspace dependencies. Billing typecheck exits 2 on both main and this branch with the same 12 diagnostics: six `TS2769` errors in `profitabilityReportActions.ts`, three Tiptap errors in `packages/ui/src/editor/TextEditor.tsx`, and the shared `applyTemplates.ts` `TS2769`. Client Portal typecheck exits 2 on both with the same 23 diagnostics in shared UI/dependency and checklist code; neither run reports errors in `client-billing.ts`, `InvoicesTab.tsx`, or `InvoiceDetailsDialog.tsx`. Temporal `type-check` fails on main and branch with the same shared `sanitizeEmailHtml.ts` `TS2345` and `applyTemplates.ts` `TS2769` diagnostics. The Temporal build has 140 diagnostics on main and 139 on this branch; both include the existing Redis client declaration `TS2742` family in `packages/event-bus/src/config/redisConfig.ts` plus the two shared errors. Main also has one missing extension activity module diagnostic that is absent on this branch. In the retry-safety repair check, Temporal type-check/build still report only those shared errors plus Redis declaration errors; neither reports diagnostics in `job-activities.ts`. Server typecheck with the default 4 GB heap ran out of memory; rerunning with 8 GB completed with its existing unrelated workspace diagnostics and none in the changed server modules `job.service.ts`, `maintenanceJobSubscriber.ts`, `invoiceEmailHandler.ts`, or `forwardedJobPersistence.integration.test.ts`. These compiler failures do not replace the passing behavioral suites, and no actual SMTP delivery is simulated by them.
