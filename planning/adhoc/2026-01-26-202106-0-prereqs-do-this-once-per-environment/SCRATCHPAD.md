# Scratchpad

## Status

- Converted all scaffolded workflow-harness fixtures into business-valid, notification-based fixtures with deterministic DB assertions and cleanup.

## Notes / Decisions

- Harness “channels” confirmed:
  - Session+tenant context: `Cookie` + `x-tenant-id` injected in `tools/workflow-harness/lib/http.cjs` (`createHttpClient`, lines ~22–36).
  - Optional REST API auth: auto-injects `x-api-key` from `WORKFLOW_HARNESS_API_KEY` / `ALGA_API_KEY` if not already set (`tools/workflow-harness/lib/http.cjs`, lines ~32–36).
  - DB assertions + cleanup: `ctx.db` read-only guard and `ctx.dbWrite` write-enabled client (`tools/workflow-harness/lib/db.cjs`, lines ~5–48; wired in `tools/workflow-harness/run.cjs`, lines ~126–190).
- Failure artifacts confirmed:
  - Root: `<artifactsDir>/workflow-harness/<fixture>/<timestamp>[-<runId>]/...` (`tools/workflow-harness/lib/artifacts.cjs`, lines ~15–37).
  - Failure payloads written in `tools/workflow-harness/run.cjs` catch block (starts ~262), including `failure.context.json` and `failure.error.txt`.
- Inventory results:
  - Found **139 scaffolded fixtures** (bundle description contains “Scaffolded catalog fixture…” AND `test.cjs` uses `_lib/scaffolded-fixture.cjs`).
  - Scaffolded fixtures currently hardcode `payload.TicketCreated.v1` regardless of event; conversion must fix schema refs first.
  - Unique event types across scaffolded fixtures include several **not present** in runtime schema registry today (need new `payload.*.v1` refs + schemas):
    - `APPOINTMENT_REQUEST_*` (CREATED/APPROVED/DECLINED/CANCELLED)
    - `SCHEDULE_ENTRY_*` (CREATED/UPDATED/DELETED)
    - `PROJECT_ASSIGNED`, `PROJECT_CLOSED`
    - `TIME_ENTRY_APPROVED`, `TIME_ENTRY_SUBMITTED`
    - `TASK_COMMENT_ADDED`, `TASK_COMMENT_UPDATED`
    - `TICKET_COMMENT_ADDED`, `TICKET_ADDITIONAL_AGENT_ASSIGNED`
    - `PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED`
  - Note: `/api/workflow/events` ingestion auto-injects `tenantId` + `occurredAt` via `buildWorkflowPayload(...)` before schema validation (`server/src/lib/actions/workflow-runtime-v2-actions.ts`, around `submitWorkflowEventAction`), so tests can omit those fields.
- Conversion approach (scale decision):
  - Implemented a generic notification-based fixture template using `notifications.send_in_app` as the persisted side effect.
  - Standardized fixture-only payload fields:
    - `payload.fixtureNotifyUserId` (recipient user id)
    - `payload.fixtureDedupeKey` (deterministic marker/correlation + action idempotency)
    - `payload.fixtureBadUserId` (try/catch fixtures only)
    - `payload.fixtureVariant` (multi-branch fixtures only)
  - Control-flow patterns applied by fixture name:
    - default/idempotent: `control.if`
    - foreach*: `control.forEach`
    - trycatch*: `control.tryCatch`
    - multi-branch*: nested `control.if`
    - callworkflow*/subworkflow*: `control.callWorkflow` + child workflow, patched/published inside `test.cjs`
  - Assertion target: `internal_notifications` rows containing `[fixture <name>]` and the `fixtureDedupeKey`.
- Added runtime schema refs for legacy event types needed by the converted fixtures:
  - Scheduling legacy: `payload.ScheduleEntry*`, `payload.AppointmentRequest*`
  - Projects legacy: `payload.ProjectAssigned`, `payload.ProjectClosed`, `payload.ProjectTaskAdditionalAgentAssigned`, `payload.TaskComment*`
  - Tickets legacy: `payload.TicketCommentAdded`, `payload.TicketAdditionalAgentAssigned`
  - Time legacy: `payload.TimeEntrySubmitted`, `payload.TimeEntryApproved`

## Commands / Runbook

- Find scaffolded fixtures:
  - `rg -l "_lib/scaffolded-fixture" ee/test-data/workflow-harness/*/test.cjs | xargs -n1 dirname | sed 's|^ee/test-data/workflow-harness/||' | sort`
  - `rg -l "Scaffolded catalog fixture" ee/test-data/workflow-harness/*/bundle.json | xargs -n1 dirname | sed 's|^ee/test-data/workflow-harness/||' | sort`
  - Both produced **139** identical fixture ids.
- Summarize scaffolded trigger event types:
  - `cat /tmp/scaffolded-by-bundle.txt | while read -r f; do jq -r '.workflows[0].metadata.trigger.eventName' "ee/test-data/workflow-harness/$f/bundle.json"; done | sort | uniq -c | sort -nr`
- Convert all scaffolded fixtures (one-time):
  - `node tools/workflow-harness/convert-scaffolded-fixtures.cjs`
- Quick sanity checks:
  - `rg "_lib/scaffolded-fixture" ee/test-data/workflow-harness -S` (expect none)
  - `rg "Scaffolded catalog fixture" ee/test-data/workflow-harness -S` (expect none)
  - `node --test tools/workflow-harness/tests/runner-stubbed.test.cjs`

## Gotchas

- `transform.assign` evaluation order gotcha: don’t build a string from `vars.marker` inside the same assign map unless split into multiple steps (marker can be omitted).
- Zod validation in `submitWorkflowEventAction` checks success but does not replace payload with `validation.data`, so **unknown payload keys remain available** to workflows (useful for fixture-only fields like `payload.fixtureNotifyUserId`).
- `notifications.send_in_app` is idempotent; `forEach` fixtures must vary `dedupe_key` per iteration or inserts collapse to 1.
