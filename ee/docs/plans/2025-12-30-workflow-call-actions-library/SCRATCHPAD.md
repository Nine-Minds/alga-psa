# Scratchpad — Workflow Call Actions Library (Business Operations)

- Plan slug: `workflow-call-actions-library`
- Created: `2025-12-30`

## What This Is
Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions
- (2025-12-30) Start with 18 first-party “business operations” call actions spanning ticketing, lookup, communication, scheduling, projects, time, and notes.
- (2025-12-30) Treat every action as schema-first: input/output schema + consistent error codes + consistent audit/telemetry.

## Discoveries / Constraints
- (2025-12-30) Auth/session checks can trigger DB pool exhaustion in dev if connection pools leak across hot reload; keep action execution paths short-lived and avoid unbounded parallelism.

## Commands / Runbooks
- (2025-12-30) Validate plan files: open `PRD.md`, ensure `features.json` and `tests.json` are valid JSON arrays; keep `implemented` booleans accurate as work lands.

## Links / References
- `ee/docs/plans/2025-12-21-workflow-overhaul.md`
- `ee/docs/plans/2025-12-27-workflow-trigger-payload-mapping/PRD.md`
- `ee/docs/plans/2025-12-28-workflow-payload-contract-inference/PRD.md`

## Open Questions
- Which permission names/scopes should each action enforce (tickets vs scheduling vs time)?
- What is the canonical “schedule entry” entity in Alga PSA v2 workflows (and how do we model conflicts)?
- Which actions require idempotency guarantees on day one (create ticket, send email, create schedule, create time entry)?

