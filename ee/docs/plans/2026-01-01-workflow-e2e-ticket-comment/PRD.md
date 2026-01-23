# PRD — Workflow E2E: Ticket Created → Add Comment

- Slug: `workflow-e2e-ticket-comment`
- Date: `2026-01-01`
- Status: Draft

## Summary

Add a Playwright integration test that validates a **very basic workflow runs end-to-end** with the v2 workflow runtime + worker:

1. A user creates a **new workflow** in Automation Hub / Designer.
2. The workflow is **triggered by the `TICKET_CREATED` event**.
3. The workflow runs one action: **`tickets.add_comment`** with body `hello from workflow`.
4. The test creates a new ticket to trigger the event.
5. The test asserts:
   - A comment is added to the created ticket.
   - A workflow run record exists and completes successfully.

This is intended as a “canary” test proving the workflow engine is wired correctly (UI → persistence → event ingestion → worker execution → business side effect).

## Problem

We currently lack an automated, end-to-end regression test proving:
- workflow definitions created in the UI can be activated,
- runtime events are emitted on real application actions (ticket creation),
- the worker consumes events and executes workflow logic,
- the workflow produces a real side effect (ticket comment).

Without this, workflow/runtime regressions are easy to introduce and hard to diagnose.

## Goals

1. Verify the workflow worker/runtime processes a real `TICKET_CREATED` event.
2. Verify the runtime executes `tickets.add_comment` correctly.
3. Verify the user-auth/tenant scoping is correct (comment created under the tenant that created the ticket).
4. Make the test deterministic and debuggable (clear assertions + DB verification).

## Non-goals

- Exhaustive coverage of designer capabilities.
- Testing workflow waits, retries, or complex branching.
- Validating event catalog simulation flows.

## Users and Primary Flows

### Persona
- Internal Admin user configuring workflows.

### Primary flow (under test)
1. Navigate to Automation Hub → Workflows/Designer.
2. Create a new workflow.
3. Select trigger event: `TICKET_CREATED`.
4. Add action step: “Add Ticket Comment”.
5. Publish/activate workflow.
6. Create a new ticket.
7. Observe the workflow run and comment side effect.

## UX / UI Notes

The test will need stable selectors for:
- Automation Hub navigation (top-row tabs: Workflows, Designer, Runs, Event Catalog)
- “Create workflow” affordance
- Trigger event picker (select `TICKET_CREATED`)
- Action library selection (select `tickets.add_comment`)
- Input mapping UI (map `ticket_id` from trigger payload, set `body`)
- Publish/activate workflow
- Ticket creation UI (fill required fields)
- Ticket detail page comment timeline/list

If selectors are missing or unstable, add `data-automation-id` attributes to critical controls rather than relying on text-only locators.

## Requirements

### Functional Requirements

1. The test can create a new workflow in the designer and persist it.
2. The workflow can be activated/published and becomes eligible to run.
3. Creating a ticket publishes `TICKET_CREATED` with a payload that includes `ticketId`.
4. The worker consumes the event and starts a workflow run.
5. The workflow executes `tickets.add_comment` and writes a comment to the `comments` table for that ticket.
6. The UI shows the “hello from workflow” comment on the ticket.

## Implementation Outline

### Playwright test skeleton

- Test location: `ee/server/src/__tests__/integration/workflow-ticket-created-add-comment.playwright.test.ts`
- Follow the established helpers/patterns:
  - `applyPlaywrightAuthEnvDefaults()`
  - `createTestDbConnection()`
  - `createTenantAndLogin(db, page, ...)`
  - `resolvePlaywrightBaseUrl()`
- Use DB-backed polling helpers in the test to wait for:
  - the workflow comment row to appear in `comments`
  - the corresponding `workflow_runs` row to reach a terminal success status

### Worker/runtime dependency

The Playwright run must include a live workflow worker connected to the same DB/Redis as the dev server:
- Preferred: start/stop a dockerized worker from Playwright global setup/teardown (mirrors existing MinIO setup).
- Alternative: start a host process in parallel with `npm run dev`.

### Non-functional Requirements

1. **Determinism:** The test avoids race conditions by waiting on a DB-backed condition (comment row / workflow run state), not only UI timing.
2. **Debuggability:** On failure, capture:
   - screenshot/video (Playwright defaults)
   - workflow id + run id (from DB query)
   - worker logs location/command to tail
3. **Isolation:** The test runs against a dedicated Playwright database and does not rely on pre-existing workflows.

## Data / API / Integrations

### Relevant tables (expected)
- `workflow_definitions`, `workflow_definition_versions`
- `workflow_runtime_events`
- `workflow_runs`, `workflow_action_invocations`
- `tickets`, `comments`

### Key runtime entities
- Trigger event type: `TICKET_CREATED`
- Action: `tickets.add_comment` (v1)

## Security / Permissions

- Test tenant must have sufficient permissions to:
  - manage workflows (create/publish/activate)
  - create tickets
  - update tickets (add comments) via workflow action execution context

## Observability

Test assertions should include DB queries proving:
- event record exists in `workflow_runtime_events` for `TICKET_CREATED`
- run record exists in `workflow_runs` and transitions to a terminal success state
- comment row exists in `comments` with `note = "hello from workflow"`

## Rollout / Migration

None. This is a test + minor infra wiring (starting the worker for Playwright).

## Test Environment Setup (Local)

This plan assumes a **repeatable Playwright dependency stack** is available:
- Postgres (reachable from host at `PLAYWRIGHT_DB_HOST:PLAYWRIGHT_DB_PORT`)
- Redis (reachable from host at `REDIS_HOST:REDIS_PORT`)
- Workflow worker connected to the same Postgres + Redis

To avoid conflicts with other worktrees, use the `alga-test-env-setup` port detection + secrets generation:

1. Detect a free port set (example env number 2):
   - `python3 /Users/roberisaacs/.codex/skills/alga-test-env-setup/scripts/detect_ports.py --env-num 2`
2. Generate dedicated secrets (recommended: keep separate from developer secrets):
   - `python3 /Users/roberisaacs/.codex/skills/alga-test-env-setup/scripts/generate_secrets.py --secrets-dir ./secrets-playwright --force`
3. Start dependency containers using the detected ports (implementation choice):
   - Option A: create a dedicated `docker-compose.playwright-deps.yml` (postgres + redis + worker) and start/stop it from Playwright global setup/teardown.
   - Option B: reuse an existing e2e compose (e.g. `docker-compose.e2e-with-worker.yaml`) but parameterize ports via env.

Playwright must be pointed at these ports via env vars:
- `PLAYWRIGHT_DB_HOST`, `PLAYWRIGHT_DB_PORT`, `PLAYWRIGHT_DB_NAME`
- `PLAYWRIGHT_DB_ADMIN_PASSWORD` and `PLAYWRIGHT_DB_APP_PASSWORD` (can point at `/run/secrets/<name>`; bootstrap resolves to `./secrets/<name>`)
- `REDIS_HOST`, `REDIS_PORT` (+ `REDIS_PASSWORD` if required)

## Open Questions

1. What is the canonical Automation Hub route path for:
   - workflows list
   - designer “new workflow” mode
2. What are the stable `data-automation-id` selectors for:
   - event trigger picker
   - adding an action from the action library
   - mapping trigger payload → action inputs
3. What is the authoritative terminal success status in `workflow_runs.status` (e.g., `SUCCEEDED` vs `COMPLETED`)?
4. How should the Playwright environment start the workflow worker?
   - Option A: start a host process via `npm --workspace=services/workflow-worker run dev`
   - Option B: start a Docker container (compose) like the existing MinIO setup does
   - Decision criteria: reliability + ease of local debugging + CI friendliness

## Acceptance Criteria (Definition of Done)

- A Playwright test exists that:
  - creates a workflow (trigger `TICKET_CREATED`, action `tickets.add_comment` with body `hello from workflow`)
  - creates a ticket
  - verifies the comment appears on the ticket
  - verifies a workflow run completed successfully
- The test starts required dependencies (at least Postgres, Redis, workflow worker) in a repeatable way.
- Running the test locally produces a deterministic pass on a clean environment.
