# SLA worker email review walkthrough

The current, self-contained human review is the [hosted guide](http://100.109.101.64:43207/). It supersedes the historical walkthrough below and records its exact tested PR HEAD, fresh SMTP receipts, audit transitions, failure/recovery, and repeatable fixtures. During preparation, a real escalation exposed an existing failure when the escalation manager was already the primary assignee; the service now skips the duplicate additional-resource insert while preserving notification delivery, with a database behavioral regression test.

## Review state and revisions

Open the [captain-facing walkthrough](http://100.109.101.64:43207/). It contains the chaptered recording, route settings, observed audit outcomes, worker error log, and reproduction steps.

- Tested delivery implementation: `d7a067bb76493aabc6f09f2ac903179b7851c0d6`.
- The original guide was added at `652b9ef043232b5862a42f32ae1460b27be2eb3b`; this repair replaces the recording and expands the reproduction instructions. These documentation changes do not change the tested delivery code.
- The board has not recorded Open Review or human approval. The connected runtime returned `Unknown workflow command: workflow-open-review`; see [the probe](evidence/review-open-probe.txt).

The environment’s saved `dev-server` was automatically resumed by the environment manager during the earlier repair preflight. The app was already answering requests for the review. This walkthrough does not require starting or restarting the app server.

## Recording chapters

[Play the 40-second walkthrough](assets/walkthrough-final.webm) with [chapter captions](assets/walkthrough-final.vtt).

- 00:06 — Accessible Email Logs screen and in-app notifications; no denied ticket.
- 00:11 — Board A outbound route and matching sender header.
- 00:16 — Board B distinct route and sender header.
- 00:21 — Reported `queued` observation and archived final `sent` rows, with provenance.
- 00:26 — SMTP refusal, `failed` audit, and worker log with both identifiers.
- 00:31 — In-app notifications remain functional.
- 00:36 — Repeatable setup and exact commands.

## Observed results

### Board routes and successful delivery

The live app’s board editor showed the configured sender for each board. The emitted message details and GreenMail receipts then showed the corresponding sender headers and message IDs.

| Board | Board ID | Sender shown in board settings | Ticket | Final audit | GreenMail message ID |
| --- | --- | --- | --- | --- | --- |
| SLA Email Smoke A | `3d5269d8-0000-4000-8000-00000000000a` | `sla-smoke-a@emeraldcity.oz` | `SLA-REVIEW-A` | `sent` | `<17062377-50e4-3c1a-bf1a-9bf5241a73ca@emeraldcity.oz>` |
| SLA Email Smoke B | `3d5269d8-0000-4000-8000-00000000000b` | `sla-smoke-b@emeraldcity.oz` | `SLA-REVIEW-B` | `sent` | `<3e45bf18-0a68-b499-8f27-fb2e80b98fe7@emeraldcity.oz>` |

The fresh successful-delivery snapshot was checked on 2026-11-08 at `d7a067bb76493aabc6f09f2ac903179b7851c0d6`. Both message IDs match the provider IDs in the audit and GreenMail receipts. The Email Logs detail shows SMTP `250 OK`.

See [Board A settings](evidence/screenshots/board-a-route.png), [Board B settings](evidence/screenshots/board-b-route.png), the [Board A delivered message](evidence/screenshots/board-a-smtp-detail.png), the [Board B delivered message](evidence/screenshots/board-b-smtp-detail.png), and [fresh delivery JSON](evidence/live-delivery.json).

### Audit progression and provenance

The earlier 2026-11-01 live smoke note for the same implementation revision reports that a database poll observed the successful escalation audits at `queued` before delivery completed. It then records the same `SLA-MAIL-A` and `SLA-MAIL-B` audits at `sent`, with provider message IDs. The poll output itself was not retained, so `queued` is labeled as a reported live observation, not as a screenshot or archived query result.

The 2026-11-08 fresh run independently confirms the final `sent` rows for `SLA-REVIEW-A` and `SLA-REVIEW-B`. The code-level explanation is separate: escalation writes `queued` in the transaction, and its after-commit delivery hook updates the result to `sent` or `failed`. The recording labels which claims are live observations and which describe the implementation.

### Intentional SMTP refusal

The fresh failure fixture was `SLA-REPAIR-FAIL-20261108-E` on Board A. Its audit recorded `failed` with `Email provider not ready: SMTP initialization failed: connect ECONNREFUSED 127.0.0.1:1`; `inApp` remained true. The worker error contains ticket ID `3d5269d8-0000-4000-8000-00000000030e` and audit ID `e39cf4e4-343c-4f17-bdf6-145374542cbc`.

The SMTP provider’s original nested port, `3725`, was restored after the refusal. The [failure snapshot](evidence/failure-live.json) and [worker error excerpt](evidence/worker-failure.log) contain the exact result. Three repair-generated messages from earlier attempts remain in the local GreenMail inbox because its REST endpoint rejected deletion; the corresponding auxiliary app records were removed. Those messages are excluded from the successful-delivery evidence.

### In-app notifications

A fresh capture starts on the accessible Email Logs page and shows the notification bell with SLA notifications. It contains no “Permission denied” screen. The failure snapshot also records `inApp: true` for the refused email. See [the accessible notification capture](evidence/screenshots/inapp-notifications.png).

## Repeat the review

The commands below use only the already-running application and infrastructure services. They do not start or restart the app server. Run them in a QA tenant, not a customer tenant.

### 1. Confirm the fixtures and routes

The prepared QA tenant is `6d178771-ad9a-4d43-8809-83992745f8f9`. It has the two boards above, SMTP sender addresses `sla-smoke-a@emeraldcity.oz` and `sla-smoke-b@emeraldcity.oz`, and policy `SLA Email Worker Smoke` (`3d5269d8-0000-4000-8000-000000000020`). Its target is response 1 minute, resolution 2 minutes, 24x7, first escalation at 100%.

In the app, open **Settings → Ticketing → Boards** (`/msp/settings?tab=ticketing&section=boards`), edit each review board, open **Email & inbound replies**, and check **Outbound sender**. Do not save changes during review. Open **Settings → SLA** (`/msp/settings/sla`) to confirm the policy and target.

The retained successful fixtures are `SLA-REVIEW-A` (`3d5269d8-0000-4000-8000-00000000020a`) and `SLA-REVIEW-B` (`3d5269d8-0000-4000-8000-00000000020b`). Create new isolated copies if you need to run them again. The helper clones the selected ticket’s board, client, priority, and SLA policy while resetting escalation state; it only inserts a row when run without `--dry-run`:

```sh
node --env-file=server/.env.local docs/reviews/sla-worker-email/scripts/clone-ticket-fixture.mjs \
  --seed-ticket-id=3d5269d8-0000-4000-8000-00000000020a \
  --ticket-number=SLA-REVIEW-20261109-A \
  --title='SLA review repair run board A' --dry-run
```

Remove `--dry-run` to create it. Repeat with seed `...20b`, number `SLA-REVIEW-20261109-B`, and a Board B title. The helper prints each new ticket UUID. For an SMTP refusal, clone Board A with a unique `SLA-REPAIR-...` number.

### 2. Build and start the emitted worker in the isolated namespace

Build and run these exact checks first:

```sh
(cd ee/temporal-workflows && npm run test -- --run \
  src/activities/__tests__/worker-email-resolution.test.ts \
  src/activities/__tests__/sla-activities.test.ts)
(cd ee/temporal-workflows && npm run type-check)
(cd ee/temporal-workflows && npm run build)
(cd packages/email && npm run test -- \
  src/outbound/__tests__/TenantEmailOutboundAdapter.test.ts \
  src/__tests__/senderIdentity.test.ts)
(cd packages/email && npm run typecheck)
(cd packages/email && npm run build)
```

Results at implementation revision `d7a067bb76493aabc6f09f2ac903179b7851c0d6`: temporal tests passed (2 files, 24 tests); email tests passed (2 files, 9 tests); both typechecks and builds passed. The temporal build emitted these checks:

```text
Emitted escalation and SLA notification consumers both delivered through their imported email binding after commit.
Emitted worker escalation and SLA notification guards rejected selectively redirected throwing placeholders.
```

Use the explicit emitted entrypoint. `node .` did not start the worker in this environment. The namespace `sla-email-repair-20261108` was created for the live verification and is isolated from the historical namespace `sla-email-smoke-3d5269d8`.

```sh
cd ee/temporal-workflows
TEMPORAL_ADDRESS=127.0.0.1:17538 \
TEMPORAL_NAMESPACE=sla-email-repair-20261108 \
TEMPORAL_TASK_QUEUES=sla-workflows \
ENABLE_HEALTH_CHECK=true HEALTH_CHECK_PORT=18087 \
SECRET_FS_BASE_PATH="$PWD/../../secrets" \
node --env-file=../../server/.env.local dist/ee/temporal-workflows/src/worker.js
```

The worker always adds `alga-jobs` alongside `sla-workflows`; use only this review namespace. The dedicated namespace’s schedules and running workflows were cleaned after the recorded run. For a repeat, stop only the worker you started, inspect cleanup targets first, then remove only the review namespace’s schedules and running executions:

```sh
cd ../..
TEMPORAL_ADDRESS=127.0.0.1:17538 node --env-file=server/.env.local docs/reviews/sla-worker-email/scripts/cleanup-review-namespace.mjs \
  sla-email-repair-20261108
TEMPORAL_ADDRESS=127.0.0.1:17538 node --env-file=server/.env.local docs/reviews/sla-worker-email/scripts/cleanup-review-namespace.mjs \
  sla-email-repair-20261108 --apply
```

The first command is a dry run. The cleanup helper refuses namespaces outside the dedicated repair namespace. It leaves closed workflow histories available for evidence.

### 3. Start the SLA workflows and watch the audit rows

The helper reads each ticket’s policy target from the QA database, builds the review’s 24x7 schedule input, and starts the real `slaTicketWorkflow` in the isolated namespace. Start the audit watcher first so it can print each state it observes:

```sh
node --env-file=server/.env.local docs/reviews/sla-worker-email/scripts/inspect-sla-audit.mjs \
  --watch <board-a-ticket-uuid> <board-b-ticket-uuid>
```

In a second terminal:

```sh
TEMPORAL_ADDRESS=127.0.0.1:17538 \
TEMPORAL_NAMESPACE=sla-email-repair-20261108 \
TEMPORAL_TASK_QUEUE=sla-workflows \
node --env-file=server/.env.local docs/reviews/sla-worker-email/scripts/start-sla-workflow.mjs <board-a-ticket-uuid>

TEMPORAL_ADDRESS=127.0.0.1:17538 \
TEMPORAL_NAMESPACE=sla-email-repair-20261108 \
TEMPORAL_TASK_QUEUE=sla-workflows \
node --env-file=server/.env.local docs/reviews/sla-worker-email/scripts/start-sla-workflow.mjs <board-b-ticket-uuid>
```

The workflow IDs use `sla-ticket-<tenant UUID>-<ticket UUID>` and poll `sla-workflows`. With the review policy, escalation starts after one minute. The watcher prints audit outcomes as they change and exits after both rows reach `sent`, `failed`, or `skipped`. It queries only the supplied ticket IDs.

The manual audit inspection command is:

```sh
node --env-file=server/.env.local docs/reviews/sla-worker-email/scripts/inspect-sla-audit.mjs \
  <board-a-ticket-uuid> <board-b-ticket-uuid>
```

Expected successful result: each audit progresses from `queued` to `sent`; `message_id` matches GreenMail and the Email Logs detail shows SMTP `250 OK`. Check **System → Email Logs** (`/msp/email-logs`) and open each message detail. Check GreenMail’s inbox on host port `3725` for the matching `From` headers and message IDs.

### 4. Exercise the refusal and restore the provider

In the QA tenant, open **Settings → Email** (`/msp/settings/email`) and locate the active SMTP provider settings. Record the full configuration before changing it; only change its SMTP Port from `3725` to `1`. Run a new Board A workflow as above. Confirm the audit watcher reports `failed` with `ECONNREFUSED 127.0.0.1:1` and the worker error contains both `ticketId` and `auditLogId`. Restore the recorded provider settings immediately after the run, even if a command or assertion fails, by returning to the same screen and restoring the port to `3725`; save and verify the displayed value before continuing. This changes the QA tenant’s outbound mail until restoration. The existing refusal result is [failure-live.json](evidence/failure-live.json); do not leave the test provider pointed at port `1`.

### 5. Clean up and inspect

Use `/msp/email-logs` and the notification bell to confirm the delivered and refused workflows retain their in-app notices. Delete only ticket fixtures created for this repeat: open **Tickets** (`/msp/tickets`), find the exact `SLA-REVIEW-...` or `SLA-REPAIR-...` number, open its row (or `/msp/tickets/<ticket UUID>`), choose the top-right **More actions → Delete**, review the dependency check, then confirm deletion. Stop only the worker process started for this run. Run the namespace cleanup command above in dry-run mode, review the listed schedules and running workflows, then repeat with `--apply`. Do not delete schedules or workflows from `default` or from `sla-email-smoke-3d5269d8`.

## Evidence bundle

- [Fresh successful deliveries](evidence/live-delivery.json)
- [Earlier live audit observation and final-state evidence notes](evidence/audit-transition.json)
- [Fresh SMTP refusal and restored provider](evidence/failure-live.json)
- [Worker error with both IDs](evidence/worker-failure.log)
- [Worker run excerpt and isolated namespace](evidence/worker-run.log)
- [Open Review probe](evidence/review-open-probe.txt)
- [Exact tested specification](https://github.com/Nine-Minds/alga-psa/blob/d7a067bb76493aabc6f09f2ac903179b7851c0d6/docs/plans/2026-11-01-sla-worker-email-and-audit-truth-spec.md)
- [Temporal SLA backend used by the live application](https://github.com/Nine-Minds/alga-psa/blob/d7a067bb76493aabc6f09f2ac903179b7851c0d6/ee/server/src/lib/sla/TemporalSlaBackend.ts)
- [Repository guide at a revision that contains it](https://github.com/Nine-Minds/alga-psa/blob/652b9ef043232b5862a42f32ae1460b27be2eb3b/docs/reviews/sla-worker-email/README.md)
- [PR #4085](https://github.com/Nine-Minds/alga-psa/pull/4085)
