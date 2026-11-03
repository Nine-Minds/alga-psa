# Invoice email Temporal runtime verification

Use this runbook to connect a board-managed Alga PSA worktree and its built Temporal worker to a reachable local Temporal server. Keep the app and worker in board services. Do not launch a separate app server.

The worker registers `invoice_email` by forwarding it over the event bus to the app's `MaintenanceJobSubscriber`. The app executes `InvoiceEmailHandler`, generates the PDF, and sends the email. Both processes must use the same database and Redis configuration. Worker health and Temporal workflow completion alone do not prove that the app executed the handler or delivered the message.

## Prerequisites

- The current workflow step declares the `dev-server` service in its `services` list. The board automatically suspends that service when the current step does not use it. In the Alga Task Office workflow, `Smoke Test` declares the app service; `Draft Implementation` does not.
- The worktree's supporting database and GreenMail services are running, and the app's configured email provider routes outbound messages to that GreenMail instance.
- `server/.env.local` and `secrets/alga_auth_key` exist in the worktree. Do not copy their contents into service commands, logs, or this document.
- The app's development-login provisioning reads `credential_encryption_key` from the configured secret provider and then checks `CREDENTIAL_ENCRYPTION_KEY`; if it is absent or shorter than 32 characters, it falls back to `NEXTAUTH_SECRET`. The source throws only if that fallback is also unavailable. The repo's intended EE vault secret is `secrets/credential_encryption_key` (or a configured secret-provider value). This worktree has no local credential key file or env entry. Before Smoke Test, verify the board app service can read the legitimate local key used for this environment, or verify `NEXTAUTH_SECRET` is present and the fallback is active. Do not generate a replacement for a database that may contain encrypted credentials. The reported startup error was not reproducible from source inspection alone and must be checked in service logs after startup.
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

Use the authenticated client account owning invoice `SMOKE-AUTHZ-1102`. In **Billing → Invoices → invoice menu → Email**, submit a resend. Correlate its new job id with `MAINTENANCE_JOB_REQUESTED` consumption and the `InvoiceEmailHandler` completion log. Verify a new invoice sending log and an actual GreenMail message whose MIME attachment contains the invoice PDF. The action may report success only after the durable job reaches completed; event publication alone is not completion.

Through authenticated entry points, rerun scheduler denial for an internal user with `billing:create` and `billing:read` but without `invoice:send`, then verify allowance with `invoice:send`. Rerun immediate-send authorization parity. Through an authenticated internal user linked to a portal contact, invoke portal resend and confirm rejection before enqueue or delivery. Reload the UI repeatedly and verify the invoice menu opens and accepts recorded interactions each time. Do not replace these checks with direct job enqueue calls or fixture-only tests.
