# Workflow Worker: Build Failure Propagation and Email Workflow Diagnosis

## Executive Summary
- Build step failures during Docker build were not failing the Argo step due to missing `set -e` in multi-line shell scripts. This caused a misleading success message after a failed build.
- The System Email Processing workflow fails at start with “Missing required email data in trigger event” because inbound events only contain a `historyId` and related metadata; the workflow expects concrete email identifiers/content.
- The same business event starts the workflow twice: once via a direct “start by version ID” path and again via the Redis global event stream. This likely causes duplicate executions.

Remediations in place:
- Added `set -e` to all `sh -c` steps in `workflow-worker-workflow.yaml` and applied the updated WorkflowTemplate to the `argo` namespace, ensuring failing commands propagate as step failures.

Remediations proposed:
- Change the System Email Processing workflow to treat `historyId` as the trigger and fetch email(s) via Gmail APIs before proceeding.
- Prevent duplicate starts by choosing a single trigger path for this event type and/or adding a Redis idempotency guard.

---

## Observed Symptoms
- Docker build logs show a TypeScript error and `npm ERR!` followed by: “ERROR: ... did not complete successfully: exit code: 1”, yet the step prints “Buildx build completed successfully!” and the workflow proceeds.
- Application logs for System Email Processing show immediate failure: “Missing required email data in trigger event”, despite payloads including `providerId`, `mailbox`, and `historyId` under `webhookData`.
- The same inbound event appears to trigger two workflow starts (direct and via Redis global event stream), judged by close timestamps and duplicate start messages.

---

## Technical Diagnosis

### A. Build Step Did Not Fail the Argo Task
- The Argo templates use `command: [sh, -c]` with multi-line scripts.
- Without `set -e`, a failing command (e.g., `docker buildx build` returning non-zero due to `npm run build` failure) does not terminate the script, allowing subsequent `echo` and `ls` to run and the step to complete successfully.

### B. Email Workflow Input Contract Mismatch
- Inbound event shape (from logs):
  - Top-level fields: `providerId`, `providerType`, `mailbox`, `historyId`.
  - Nested: `webhookData.emailAddress`, `webhookData.historyId`, `webhookData.messageId` (Pub/Sub message ID), timestamps, subscription.
- The workflow expects concrete email identifiers (e.g., Gmail `message.id`) or message content. Gmail push notifications generally provide only a `historyId`; clients must call `users.history.list` to identify new message IDs, then `users.messages.get` for details.
- Current validation rejects the event as missing required email data.

### C. Duplicate Workflow Starts
- Logs indicate two starts per inbound email:
  - Direct path: “Starting workflow by version ID”.
  - Global event path: “Processing global event from Redis…” followed by starting the workflow.
- Without dedupe or suppression, the same business event is processed twice.

---

## Impact
- CI/CD signal skew: Builds that actually fail may be marked successful at the workflow step, masking failures and potentially deploying bad artifacts (now fixed).
- Lost processing: Email-triggered workflows fail immediately, so inbound email events aren’t processed.
- Double-processing risk: Duplicate starts increase load and can cause duplicated side-effects if later stages succeed.

---

## Resolution Plan

### 1) Ensure Build Failures Propagate [Completed]
- Change: Prepend `set -e` to all `sh -c` scripts in `workflow-worker-workflow.yaml`.
- Status: Implemented and applied to Argo. Any non-zero command will now fail the step and the DAG edge.

### 2) Treat `historyId` as the Trigger and Fetch Email(s)
- Contract: Accept and validate only `providerId`, `mailbox`, and `historyId` from the inbound event. Do not require a Gmail `message.id` in the trigger.
- Behavior:
  - Use `historyId` to list changes via `gmail.users.history.list` (filter `messageAdded`).
  - Collect unique Gmail `message.id` values.
  - For each `message.id`, call `gmail.users.messages.get` (format `metadata` or `full`) to obtain headers/content.
  - Proceed with processing using these fetched messages.
- Validation and logging:
  - If one or more required fields are missing, log which ones and fail fast.
  - If `historyId` yields no new messages, log and end gracefully.
- Data shape to store in state (example):
  - `emailFetch: { mailbox, historyId, count, messages: [{ id, threadId, headers, snippet }] }`

Implementation outline (to be applied in your app repo):
- Normalize payload:
  - `const p = context.input.eventPayload ?? context.input.triggerEvent?.payload ?? {}`
  - `const providerId = p.providerId`
  - `const mailbox = p.mailbox ?? p.webhookData?.emailAddress`
  - `const historyId = p.historyId ?? p.webhookData?.historyId`
- Guard:
  - If any of the three are missing: log and throw with a descriptive message.
- Gmail client resolution:
  - Resolve OAuth2 credentials by `providerId` and instantiate a Gmail client.
- Fetch:
  - `users.history.list` with `startHistoryId=historyId`, handle pagination, collect `messagesAdded[].message.id`.
  - `users.messages.get` for each id, desired format and headers.
- Proceed:
  - Update state with fetched messages and continue the workflow logic.

Notes:
- `webhookData.messageId` is a Pub/Sub message ID; do not use as Gmail email ID.
- Optionally, start one workflow execution per Gmail `message.id` for better isolation and retries.

### 3) Avoid Duplicate Workflow Starts
- Preferred: Choose a single trigger path for `INBOUND_EMAIL_RECEIVED`.
  - Recommendation: Rely on the Redis global event path and suppress any “direct start by version ID” for this event type.
- Additional safety: Redis idempotency guard.
  - Key format: `dedupe:workflow:INBOUND_EMAIL_RECEIVED:${tenant}:${providerId}:${historyId}`
  - Use `SET key value NX EX 300` before starting; skip start if the key exists.

Proposed changes (app repo):
- Config: `suppressImmediateStartForEventTypes = ['INBOUND_EMAIL_RECEIVED']`.
- In the immediate-start path, return early if suppressed.
- In the global event handler, apply the idempotency guard before start.

---

## Acceptance Criteria
- Build step:
  - A failing `npm run build` inside Docker causes the Argo step to fail, and the workflow stops before Helm deploy.
- Email workflow:
  - Given an event with `providerId`, `mailbox`, `historyId`, the workflow fetches Gmail message(s) and proceeds without the “Missing required email data” error.
  - If no messages are found since `historyId`, the workflow completes gracefully with a descriptive log.
- Deduplication:
  - A single inbound Gmail push event leads to at most one workflow execution for the same `(tenant, providerId, historyId)` within the dedupe window.

---

## Rollout Plan
- Step 1 (done): Apply `set -e` to Argo WorkflowTemplate.
- Step 2: Implement history-based fetch in System Email Processing workflow and deploy the app.
- Step 3: Add suppression of direct start for `INBOUND_EMAIL_RECEIVED` and idempotency guard in global event handler; deploy the app.
- Step 4: Monitor logs and metrics; verify failure propagation and single execution per event.

---

## Operational Considerations
- Secrets: The current WorkflowTemplate contains inline registry credentials. Prefer Kubernetes secrets and service accounts for registry access; avoid embedding credentials directly in templates.
- Observability: Add structured logs indicating which fields were present/missing at validation time, counts of messages fetched, and dedupe decisions.
- Testing: Add unit tests for payload normalization and history-to-message-id conversion; add integration tests against mocked Gmail APIs if feasible.

---

## Artifacts Changed (in this repo)
- `workflow-worker-workflow.yaml`: Added `set -e` to all relevant `sh -c` scripts, ensuring failures propagate. Applied to the `argo` namespace.
- `server/src/services/email/providers/GmailAdapter.ts`: Added `listMessagesSince(historyId)` to fetch Gmail message IDs via `users.history.list` with pagination and update last `history_id`.
- `server/src/app/api/email/webhooks/google/route.ts`: Changed webhook handling to fetch Gmail messages using `historyId` and publish one `INBOUND_EMAIL_RECEIVED` event per message with full `emailData`.

Result: System Email Processing workflows now receive enriched payloads (`emailData`) for Gmail, unblocking execution without changing workflow code.

---

## Open Questions
- Should one workflow execution process multiple Gmail messages, or should each message spawn its own execution for isolation and retries?
- What is the desired message format for downstream steps (headers-only vs full body)?
- How long should dedupe windows be for inbound events (e.g., 5 minutes vs longer)?
