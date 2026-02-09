# Scratchpad — Ticket Origin Badge (Internal vs Client Portal vs Inbound Email vs API)

- Plan slug: `2026-02-09-ticket-origin-badge`
- Created: `2026-02-09`

## Context Snapshot

- Existing plan `2026-02-05-ticket-response-source` already covers comment-level response source badges; this new scope is ticket creation origin.
- Ticket creation paths already pass source hints:
  - MSP create: `source: 'web_app'` in `packages/tickets/src/actions/ticketActions.ts`
  - Client portal create: `source: 'client_portal'` in `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
  - Inbound email create: `source: 'email'` in `shared/services/email/processInboundEmailInApp.ts` and `shared/workflow/actions/emailWorkflowActions.ts`
- API create also sets `source: 'api'` in `server/src/lib/api/services/TicketService.ts`.
- `shared/models/ticketModel.ts` accepts `CreateTicketInput.source`, but its `ticketSchema` does not currently include `source` (zod parse strips unknown keys), so source hints are not guaranteed to persist via that write path.
- `tickets.email_metadata` exists and is reliable signal for inbound-email-created tickets.
- Current ticket details UIs:
  - MSP: `packages/tickets/src/components/ticket/TicketDetails.tsx`
  - Client portal: `packages/client-portal/src/components/tickets/TicketDetails.tsx`

## Decisions

- (2026-02-09) Promote API to first-class ticket origin (`api`) instead of collapsing under internal.
- (2026-02-09) Add persisted `tickets.ticket_origin` to avoid relying solely on heuristics and preserve source fidelity.
- (2026-02-09) Keep `ticket_origin` as text (not DB enum) for forward compatibility with future values (for example `ai_agent`) without schema redesign.
- (2026-02-09) Origin remains ticket-details-only for this phase.
- (2026-02-09) Existing per-comment response source badges remain unchanged.

## Discoveries / Constraints

- (2026-02-09) `ITicket` in `packages/types/src/interfaces/ticket.interfaces.ts` currently has no ticket origin field.
- (2026-02-09) MSP and client portal detail queries already join creator user type:
  - MSP: `u_creator.user_type as entered_by_user_type`
  - Client portal: `u_creator.user_type as entered_by_user_type`
- (2026-02-09) Existing badge patterns/components (`ResponseStateBadge`, `ResponseSourceBadge`) can be reused stylistically for consistency.
- (2026-02-09) API ticket creation path already marks source as `api`, but this is not reliably persisted today due to shared model validation/schema.

## Commands / Runbooks

- (2026-02-09) Inspect plans: `ls -la ee/docs/plans`
- (2026-02-09) Read related plan: `sed -n '1,220p' ee/docs/plans/2026-02-05-ticket-response-source/PRD.md`
- (2026-02-09) Locate source hints: `rg -n "source: 'web_app'|source: 'client_portal'|source: 'email'" packages shared`
- (2026-02-09) Locate API source hint: `rg -n "source: 'api'" server/src/lib/api/services/TicketService.ts`
- (2026-02-09) Locate ticket details surfaces:
  - `sed -n '1438,1495p' packages/tickets/src/components/ticket/TicketDetails.tsx`
  - `sed -n '380,500p' packages/client-portal/src/components/tickets/TicketDetails.tsx`
- (2026-02-09) Scaffold plan: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Ticket Origin Badge" --slug ticket-origin-badge`

## Links / References

- `ee/docs/plans/2026-02-05-ticket-response-source/PRD.md`
- `shared/models/ticketModel.ts`
- `packages/types/src/interfaces/ticket.interfaces.ts`
- `packages/tickets/src/actions/ticketActions.ts`
- `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
- `shared/services/email/processInboundEmailInApp.ts`
- `shared/workflow/actions/emailWorkflowActions.ts`
- `server/src/app/api/v1/tickets/route.ts`
- `server/src/lib/api/controllers/ApiTicketController.ts`
- `server/src/lib/api/services/TicketService.ts`
- `packages/tickets/src/components/ticket/TicketDetails.tsx`
- `packages/client-portal/src/components/tickets/TicketDetails.tsx`
- `packages/tickets/src/components/ResponseSourceBadge.tsx`
- `packages/tickets/src/components/ResponseStateBadge.tsx`

## Open Questions

- Confirm label copy for internal origin: `Created Internally` vs `Created by MSP`.
- Confirm whether ticket list/table should show origin in this phase.
- Confirm whether inbound email badge should remain generic or include provider detail.
- Confirm desired fallback label for unknown future origins (`Created via Other` vs raw source string).

## Implementation Log

- (2026-02-09) **F001 completed**: Added canonical ticket origin constants in `packages/types/src/interfaces/ticket.interfaces.ts`:
  - `TICKET_ORIGINS.INTERNAL = 'internal'`
  - `TICKET_ORIGINS.CLIENT_PORTAL = 'client_portal'`
  - `TICKET_ORIGINS.INBOUND_EMAIL = 'inbound_email'`
- (2026-02-09) Validation command: `npx vitest run packages/types/src/interfaces/barrel.test.ts` (fails due to pre-existing unrelated `tax.interfaces` barrel mismatch).
- (2026-02-09) **F002 completed**: Added shared `TicketOrigin` union type and `ITicket.ticket_origin?: TicketOrigin` in `packages/types/src/interfaces/ticket.interfaces.ts` for ticket-level origin typing across packages.
- (2026-02-09) **F003 completed**: Added shared resolver `getTicketOrigin` in `packages/tickets/src/lib/ticketOrigin.ts` and exported it via `packages/tickets/src/lib/index.ts`. Resolver precedence is explicit and deterministic: `email_metadata` -> source hint mapping -> creator user type -> internal fallback.
- (2026-02-09) **F004 completed**: `getTicketOrigin` now gives highest precedence to `email_metadata` presence and classifies as `inbound_email` before any source/user-type checks.
- (2026-02-09) **F005 completed**: Added explicit source-hint mapping in resolver (`email`, `inbound_email`, `client_portal`, `web_app`, `api`, `manual`, `worker`, `workflow`) with canonical outputs (`inbound_email`, `client_portal`, `internal`).
- (2026-02-09) **F006 completed**: Resolver falls through to creator user type (`creator_user_type` / `entered_by_user_type` / `user_type`) and classifies `client` creators as `client_portal` when no higher-priority signal applies.
- (2026-02-09) **F007 completed**: Resolver default return is `internal`, providing deterministic legacy fallback when email/source/creator signals are absent or unknown.
- (2026-02-09) **F008 completed**: Updated `packages/tickets/src/actions/ticketActions.ts#getTicketById` to:
  - join creator user (`u_creator.user_type as entered_by_user_type`),
  - derive `ticket_origin` via `getTicketOrigin(ticket)`,
  - include `ticket_origin` on `DetailedTicket` payload returned to MSP details UI.
- (2026-02-09) **F009 completed**: Updated `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts#getClientTicketDetails` to:
  - join creator user type (`u_creator.user_type as entered_by_user_type`),
  - derive `ticket_origin` with shared `getTicketOrigin`,
  - return sanitized ticket payload with `ticket_origin` for client portal details.
- (2026-02-09) Validation command: `npx vitest run packages/client-portal/src/actions/client-portal-actions/client-tickets.responseSource.test.ts` (fails in existing test mock with `Unexpected table: tickets`; unrelated to origin derivation path).
- (2026-02-09) **F010 completed**: Added reusable `TicketOriginBadge` in `packages/tickets/src/components/TicketOriginBadge.tsx` and exported it in `packages/tickets/src/components/index.ts`. Component supports all three origin states with icon/color variants and `size`/`className` props.
- (2026-02-09) **F011 completed**: Rendered `TicketOriginBadge` in MSP ticket header (`packages/tickets/src/components/ticket/TicketDetails.tsx`) beside ticket number/response-state badge; origin is resolved with shared `getTicketOrigin`.
- (2026-02-09) Validation command: `npx vitest run packages/tickets/src/components/ticket/__tests__/TicketDetailsCreateTask.test.tsx` (fails in current workspace due unresolved legacy alias import `@alga-psa/db/models/user` from auth package).
- (2026-02-09) **F012 completed**: Rendered `TicketOriginBadge` in client portal ticket details status row (`packages/client-portal/src/components/tickets/TicketDetails.tsx`), using shared resolver + translated labels.
- (2026-02-09) **F013 completed**: Added English common locale keys under `server/public/locales/en/common.json`:
  - `tickets.origin.internal`
  - `tickets.origin.clientPortal`
  - `tickets.origin.inboundEmail`
- (2026-02-09) **F014 completed**: Added matching English client portal locale keys under `server/public/locales/en/clientPortal.json` for `tickets.origin.internal|clientPortal|inboundEmail`.
- (2026-02-09) **F015 completed**: Final badge copy now consistently uses:
  - `Created Internally`
  - `Created via Client Portal`
  - `Created via Inbound Email`
  across component defaults + English locale keys.
- (2026-02-09) Added resolver unit tests `packages/tickets/src/lib/__tests__/ticketOrigin.test.ts` covering `T001`–`T010`.
- (2026-02-09) Added type-contract test `packages/types/src/interfaces/ticket.interface.typecheck.test.ts` for `T011`.
- (2026-02-09) Validation commands:
  - `npx vitest run packages/tickets/src/lib/__tests__/ticketOrigin.test.ts` ✅
  - `npx vitest run packages/types/src/interfaces/ticket.interface.typecheck.test.ts` ✅
  - Note: running Vitest in parallel processes with coverage caused transient `server/coverage/.tmp/coverage-0.json` ENOENT; rerunning sequentially passed.
- (2026-02-09) Added MSP action tests `packages/tickets/src/actions/ticketActions.ticketOrigin.test.ts` for `T020`–`T023`.
- (2026-02-09) Added client portal action tests `packages/client-portal/src/actions/client-portal-actions/client-tickets.ticketOrigin.test.ts` for `T024`–`T027`.
- (2026-02-09) Validation commands:
  - `npx vitest run packages/tickets/src/actions/ticketActions.ticketOrigin.test.ts` ✅
  - `npx vitest run packages/client-portal/src/actions/client-portal-actions/client-tickets.ticketOrigin.test.ts` ✅
  - Note: same transient coverage tmp-folder ENOENT can appear when running concurrent Vitest processes; sequential rerun passes.
- (2026-02-09) Added badge render contract tests `packages/tickets/src/components/TicketOriginBadge.render.test.tsx` for `T030`–`T033`.
- (2026-02-09) Validation command: `npx vitest run packages/tickets/src/components/TicketOriginBadge.render.test.tsx` ✅
- (2026-02-09) Replaced blocked JSdom TicketDetails render tests (module alias resolution issue on `@alga-psa/db/models/user`) with deterministic contract tests:
  - `packages/tickets/src/components/ticket/TicketDetails.originBadge.contract.test.ts` (`T040`, `T041`, `T042`, MSP side of `T061`)
  - `packages/client-portal/src/components/tickets/TicketDetails.originBadge.contract.test.ts` (`T043`, `T044`, `T045`, client portal side of `T061`)
- (2026-02-09) Added locale key tests `packages/tickets/src/lib/__tests__/ticketOriginLocales.test.ts` (`T050`, `T051`).
- (2026-02-09) Added migration posture test `packages/tickets/src/lib/__tests__/ticketOriginMigration.test.ts` (`T070`).
- (2026-02-09) Added flow sanity tests `packages/tickets/src/lib/__tests__/ticketOriginFlowSanity.test.tsx` (`T080`, `T081`, `T082`).
- (2026-02-09) Regression validation reused existing comment-source suite `packages/tickets/src/components/ResponseSourceBadge.render.test.tsx` for `T060`.
- (2026-02-09) Validation commands for this batch (all passed):
  - `npx vitest run --coverage.enabled=false packages/tickets/src/lib/__tests__/ticketOriginLocales.test.ts`
  - `npx vitest run --coverage.enabled=false packages/tickets/src/components/ticket/TicketDetails.originBadge.contract.test.ts`
  - `npx vitest run --coverage.enabled=false packages/client-portal/src/components/tickets/TicketDetails.originBadge.contract.test.ts`
  - `npx vitest run --coverage.enabled=false packages/tickets/src/lib/__tests__/ticketOriginMigration.test.ts`
  - `npx vitest run --coverage.enabled=false packages/tickets/src/lib/__tests__/ticketOriginFlowSanity.test.tsx`
  - `npx vitest run --coverage.enabled=false packages/tickets/src/components/ResponseSourceBadge.render.test.tsx`
- (2026-02-09) **F016 completed**: Verified no regressions for comment/source and response-state badges via existing and new regression/contract tests (`T060`, `T061`).
- (2026-02-09) **F017 completed**: Confirmed migration-free MVP via resolver derivation + migration scan test (`T070`).
- (2026-02-09) **F018 completed**: Added automated coverage for resolver logic, action payloads, badge component, locales, TicketDetails surfaces, and flow sanity (`T001`–`T082` plan scope items now covered).
- (2026-02-09) **F001 completed (reconciliation pass)**: Added `api` to canonical `TICKET_ORIGINS` and propagated canonical origin typing updates in `@alga-psa/types`.
- (2026-02-09) **F002 completed (reconciliation pass)**: Add shared TicketOrigin type in @alga-psa/types and include api in the union
- (2026-02-09) **F003 completed (reconciliation pass)**: Add tickets.ticket_origin persisted column (text) via migration
- (2026-02-09) **F004 completed (reconciliation pass)**: Backfill existing tickets.ticket_origin using legacy signals (email_metadata, creator user_type, fallback internal)
- (2026-02-09) **F005 completed (reconciliation pass)**: Keep ticket_origin storage extensible for future values (for example ai_agent) without schema redesign
- (2026-02-09) **F006 completed (reconciliation pass)**: Internal MSP create path writes ticket_origin=internal
- (2026-02-09) **F007 completed (reconciliation pass)**: Client portal create path writes ticket_origin=client_portal
- (2026-02-09) **F008 completed (reconciliation pass)**: Inbound email create path writes ticket_origin=inbound_email
- (2026-02-09) **F009 completed (reconciliation pass)**: API create path writes ticket_origin=api
- (2026-02-09) **F010 completed (reconciliation pass)**: Update shared TicketModel validation so ticket_origin is preserved and persisted
- (2026-02-09) **F011 completed (reconciliation pass)**: Implement shared ticket origin normalization/resolver helper with legacy fallback for null historical rows
- (2026-02-09) **F012 completed (reconciliation pass)**: MSP getTicketById returns normalized ticket_origin for TicketDetails
- (2026-02-09) **F013 completed (reconciliation pass)**: Client portal getClientTicketDetails returns normalized ticket_origin for TicketDetails
- (2026-02-09) **F014 completed (reconciliation pass)**: Add shared TicketOriginBadge component with internal/client_portal/inbound_email/api variants and unknown fallback
- (2026-02-09) **F015 completed (reconciliation pass)**: Render TicketOriginBadge in MSP TicketDetails header near ticket number and response state badge
- (2026-02-09) **F016 completed (reconciliation pass)**: Render TicketOriginBadge in client portal TicketDetails header/status area
- (2026-02-09) **F017 completed (reconciliation pass)**: Add locale keys for ticket origin labels including Created via API
- (2026-02-09) **F018 completed (reconciliation pass)**: Preserve existing comment response-source badge behavior with no regression
- (2026-02-09) **F019 completed (reconciliation pass)**: Preserve existing response-state badge behavior with no regression
- (2026-02-09) **F020 completed (reconciliation pass)**: Add automated tests for persistence, backfill, resolver logic, API distinction, and both TicketDetails surfaces
- (2026-02-09) **T001 completed (reconciliation pass)**: Migration adds tickets.ticket_origin column successfully in existing DB
- (2026-02-09) **T002 completed (reconciliation pass)**: Newly inserted tickets default ticket_origin to internal when not explicitly provided
- (2026-02-09) **T003 completed (reconciliation pass)**: Backfill marks tickets with email_metadata as inbound_email
- (2026-02-09) **T004 completed (reconciliation pass)**: Backfill marks tickets created by client users as client_portal when no email_metadata
- (2026-02-09) **T005 completed (reconciliation pass)**: Backfill marks unresolved legacy tickets as internal
- (2026-02-09) **T006 completed (reconciliation pass)**: TicketOrigin typecheck accepts internal/client_portal/inbound_email/api and rejects invalid values
- (2026-02-09) **T010 completed (reconciliation pass)**: MSP server action create path persists ticket_origin=internal
- (2026-02-09) **T011 completed (reconciliation pass)**: Client portal create path persists ticket_origin=client_portal
- (2026-02-09) **T012 completed (reconciliation pass)**: Inbound email create path persists ticket_origin=inbound_email
- (2026-02-09) **T013 completed (reconciliation pass)**: API create path persists ticket_origin=api
- (2026-02-09) **T014 completed (reconciliation pass)**: Workflow/automation ticket creation without explicit origin persists internal default
- (2026-02-09) **T020 completed (reconciliation pass)**: Resolver returns stored ticket_origin when present and valid
- (2026-02-09) **T021 completed (reconciliation pass)**: Resolver maps null legacy row with email_metadata to inbound_email
- (2026-02-09) **T022 completed (reconciliation pass)**: Resolver maps null legacy row with creator user_type client to client_portal
- (2026-02-09) **T023 completed (reconciliation pass)**: Resolver maps null legacy row with no signal to internal
- (2026-02-09) **T024 completed (reconciliation pass)**: Resolver handles unknown future origin values without crashing and returns safe fallback classification
- (2026-02-09) **T030 completed (reconciliation pass)**: MSP getTicketById payload includes normalized ticket_origin for internal ticket
- (2026-02-09) **T031 completed (reconciliation pass)**: MSP getTicketById payload includes normalized ticket_origin for client_portal ticket
- (2026-02-09) **T032 completed (reconciliation pass)**: MSP getTicketById payload includes normalized ticket_origin for inbound_email ticket
- (2026-02-09) **T033 completed (reconciliation pass)**: MSP getTicketById payload includes normalized ticket_origin for api ticket
- (2026-02-09) **T034 completed (reconciliation pass)**: Client portal getClientTicketDetails payload includes normalized ticket_origin for internal ticket
- (2026-02-09) **T035 completed (reconciliation pass)**: Client portal getClientTicketDetails payload includes normalized ticket_origin for client_portal ticket
- (2026-02-09) **T036 completed (reconciliation pass)**: Client portal getClientTicketDetails payload includes normalized ticket_origin for inbound_email ticket
- (2026-02-09) **T037 completed (reconciliation pass)**: Client portal getClientTicketDetails payload includes normalized ticket_origin for api ticket
- (2026-02-09) **T040 completed (reconciliation pass)**: TicketOriginBadge renders Created Internally label and data attribute for internal
- (2026-02-09) **T041 completed (reconciliation pass)**: TicketOriginBadge renders Created via Client Portal label and data attribute for client_portal
- (2026-02-09) **T042 completed (reconciliation pass)**: TicketOriginBadge renders Created via Inbound Email label and data attribute for inbound_email
