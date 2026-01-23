# Scratchpad — Workflow E2E: Ticket Created → Add Comment

- Plan slug: `workflow-e2e-ticket-comment`
- Created: `2026-01-01`

## Decisions

- (2026-01-01) Use `TICKET_CREATED` as the trigger and `tickets.add_comment` as the single action to prove end-to-end runtime + worker wiring.
- (2026-01-01) Prefer DB-backed assertions (comments + workflow_runs) to avoid flaky UI-only timing.
- (2026-01-01) Start Playwright workflow deps via Docker Compose (postgres + redis + workflow worker).

## Discoveries / Constraints

- (2026-01-01) Ticket creation publishes `TICKET_CREATED` with payload including `ticketId` (see `server/src/lib/adapters/serverEventPublisher.ts`).
- (2026-01-01) Ticket comments are stored in `comments` table, column `note` (see `shared/models/ticketModel.ts`).
- (2026-01-01) Workflow runtime v2 tables include `workflow_runtime_events` + `workflow_runs` (see `server/migrations/20251221090000_create_workflow_runtime_v2_tables.cjs`).
- (2026-01-01) Playwright global setup already starts a MinIO test container via Docker Compose (`docker-compose.playwright.yml`).
- (2026-01-01) `WorkflowDesigner.tsx` supports Playwright overrides via `window.__ALGA_PLAYWRIGHT_WORKFLOW__` for deterministic UI testing.
- (2026-01-01) Workflow events are published to the Redis stream `workflow:events:global` (default event channel) and must be ingested into runtime v2 tables to start runs.
- (2026-01-01) A v2 ingestor worker exists at `services/workflow-worker/src/v2/WorkflowRuntimeV2EventStreamWorker.ts` and uses consumer group `WORKFLOW_RUNTIME_V2_EVENT_CONSUMER_GROUP` (default `workflow-runtime-v2`) to avoid competing with existing workflow processors.
- (2026-01-01) Runtime v2 `action.call` uses `config.saveAs` as an assignment path; unscoped values like `tickets.addCommentResult` must be normalized (we treat unscoped values as `vars.<value>`).
- (2026-01-01) Ticket comments UI defaults to the "Client" tab (non-internal only); tests should click "All Comments" before asserting comment text to avoid internal/public default mismatches.
- (2026-01-01) To keep the Playwright docker deps running for inspection, set `PW_KEEP_DEPS=true` (skips `ee/server/playwright.global-teardown.ts`).

## Commands / Runbooks

- Pick isolated ports for a dedicated Playwright env:
  - `python3 /Users/roberisaacs/.codex/skills/alga-test-env-setup/scripts/detect_ports.py --env-num 2`
- Generate dedicated secrets for Playwright deps:
  - `python3 /Users/roberisaacs/.codex/skills/alga-test-env-setup/scripts/generate_secrets.py --secrets-dir ./secrets-playwright --force`
- Run Playwright tests (EE):
  - `cd ee/server && npx playwright test`
- Debug worker (dev stack):
  - `docker logs -f <compose-project>-workflow-worker-1`

## Open Questions

- Do we want the Playwright compose worker to run *only* the v2 ingestor + runtime, or should it also run legacy workflow processors?
- Should v2 ingestion require `payload_schema_ref` match, or should it apply trigger payload mapping before validation?
- Are there any missing/unstable selectors in the workflow designer that should be promoted to `data-automation-id`?
