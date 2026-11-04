# Ticket historical import mitigation — 2026-11-04

## Revision and service

- Checkout and PR #3688 head: `4b2fcb016dcbd4ac5536aa7c3028693ce117ed6d`, including main `4010ca1dd0`.
- Branch: `feature/ticket-api-allow-setting-entered-at-and-comment`.
- Recovered the canonical service command and cwd from the concluded board record, then restored registration `dev-server` through `alga-dev workflow-ensure-service`:
  - Project: `51b01525-aa02-428d-bd04-12bb10e9a791`
  - Command: `PORT=3602 npm run dev`
  - Cwd: `/home/robert/alga-copies/feature-ticket-api-allow-setting-entered-at-and-comment/server`
  - Readiness: port `3602`, `/api/health`
- The required command without a command override returned the saved live registration:
  `alga-dev workflow-ensure-service --projectId=51b01525-aa02-428d-bd04-12bb10e9a791 --name=dev-server`
- `http://feature-ticket-api-allow-setting-entered-at-and-comment.localhost:3602/api/health` returned HTTP 200 (`{"status":"ok","version":"1.0.0"}`). The supervised process cwd is this worktree, at the revision above. No unmanaged server was started.

## Verification

Evidence is retained under `/tmp/alga-smoke-evidence/ticket-api-entered-at-mitigation-20261104/`.

- The recorded driver `/tmp/alga-smoke-evidence/ticket-api-entered-at-20261014T005509Z/driver.py` is absent. The compatible saved PR review regression driver at `/home/robert/.alga-xo/reviews/ticket-api-entered-at-3688/tools/regression.py` was used with the card origin and a unique run tag. It passed **26/26** checks; request/response records and the machine-readable results are in `live-regression/` and `live-regression/api/results.json`.
- REST historical open creation kept `entered_at` in the create response, GET response and database. Its source is `api_import`, SLA fields are null, its SLA audit count is zero, and Redis has no `TICKET_CREATED` event for it.
- REST historical closed creation persisted ordered `entered_at`/`closed_at`, `is_closed=true`, and `closed_by`; Redis has no `TICKET_CREATED` or `TICKET_CLOSED` event for it.
- MCP `call_api_endpoint` ticket and comment imports returned the requested historical dates and persisted those dates. MCP create/comment evidence is in `live-regression/api/I1-mcp-create.json` and `I2-mcp-comment.json`.
- Historical comments preserved `created_at`; Redis had no `TICKET_COMMENT_ADDED`. The historical ticket's response state remained null. A historical child reply left its closed bundle master closed; a live child reply reopened it and emitted `TICKET_COMMENT_ADDED`.
- Malformed and future dates, a close date before the entered date, a comment before its ticket, and invalid status-endpoint closure dates returned HTTP 400. An unauthenticated create returned HTTP 401. The focused service test also verifies a non-internal historical creator receives HTTP 403.
- Live controls proved the observable Redis event channels were active before interpreting missing historical events: live creation emitted `TICKET_CREATED` and had an SLA policy/start; live comment emitted `TICKET_COMMENT_ADDED`; live status closure emitted `TICKET_CLOSED` and `TICKET_STATUS_CHANGED`. Internal-notification counts were nonzero for live controls and zero for the historical open, historical closed and MCP imports. Workflow/webhook delivery was not separately configured or traced; the absence of their source lifecycle events is the evidence for suppression.
- A production-code search found `workflow_runtime_events` storage and read/report paths but no runtime consumer in this dev-server path. Redis event streams were therefore used for event evidence.
- The stats endpoint's today/week/30-day counts matched database counts based on `entered_at`; see `stats-summary.json`. API key registry/OpenAPI metadata checks passed in the focused contracts.
- CSV historical import integration passed both destination-board closed-status resolution and the missing-closed-status row error. The CSV importer unit tests covered the shared model timestamp path.
- UI date rendering is **unverified**. The card browser reached the sign-in page, but the saved QA password was stale on this boot; the recorded driver does not automate browser sign-in. The ticket property component formats `entered_at`, but this is code evidence only, not a live UI pass.

## Checks

- Focused historical-import unit/contract tests: 7 files, 66 tests passed.
- CSV importer unit tests: 2 files, 17 tests passed.
- Sequential database integration suites (`ticketHistoricalImport`, `ticketImportHistorical`, `ticketCreatedEventCoverage`): 3 files, 33 tests passed.
- `NODE_OPTIONS=--max-old-space-size=18432 npm run typecheck` in `server`: exit 0.
- `npx tsc --noEmit` in `packages/tickets` and `shared`: both exit 0.
- Board-managed `npm run dev` completed its dependency build and served the card origin; final readiness and command-free ensure output are in `origin-health-final.json` and `ensure-service-name-only.json`.
- `git diff --check`: passed.

## Review first

Inspect `ensure-service-name-only.json` and `origin-health-final.json` to confirm the board repair and served revision, then `live-regression/api/results.json` for the runtime checks. The only remaining validation gap is live UI date rendering because browser authentication was unavailable; no product defect was established.
