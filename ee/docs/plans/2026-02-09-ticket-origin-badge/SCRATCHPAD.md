# Scratchpad — Ticket Origin Badge (Internal vs Client Portal vs Inbound Email)

- Plan slug: `2026-02-09-ticket-origin-badge`
- Created: `2026-02-09`

## Context Snapshot

- Existing plan `2026-02-05-ticket-response-source` already covers comment-level response source badges; this new scope is ticket creation origin.
- Ticket creation paths already pass source hints:
  - MSP create: `source: 'web_app'` in `packages/tickets/src/actions/ticketActions.ts`
  - Client portal create: `source: 'client_portal'` in `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
  - Inbound email create: `source: 'email'` in `shared/services/email/processInboundEmailInApp.ts` and `shared/workflow/actions/emailWorkflowActions.ts`
- `shared/models/ticketModel.ts` accepts `CreateTicketInput.source`, but its `ticketSchema` does not currently include `source` (zod parse strips unknown keys), so source hints are not guaranteed to persist via that write path.
- `tickets.email_metadata` exists and is reliable signal for inbound-email-created tickets.
- Current ticket details UIs:
  - MSP: `packages/tickets/src/components/ticket/TicketDetails.tsx`
  - Client portal: `packages/client-portal/src/components/tickets/TicketDetails.tsx`

## Decisions

- (2026-02-09) MVP will derive `ticket_origin` from existing ticket/user fields instead of requiring a DB migration. Rationale: fastest path to user-visible badge with backward compatibility.
- (2026-02-09) Origin will be shown in ticket details only (MSP + client portal) for this phase.
- (2026-02-09) Existing per-comment response source badges remain unchanged.

## Discoveries / Constraints

- (2026-02-09) `ITicket` in `packages/types/src/interfaces/ticket.interfaces.ts` currently has no ticket origin field.
- (2026-02-09) Details actions already return `t.*`, but creator `user_type` is not always explicitly selected; derivation may require adding/joining creator metadata or computing server-side.
- (2026-02-09) Existing badge patterns/components (`ResponseStateBadge`, `ResponseSourceBadge`) can be reused stylistically for consistency.
- (2026-02-09) API ticket creation path in `server/src/lib/api/services/TicketService.ts` passes `source: 'api'`; for this feature that should likely map to `internal`.

## Commands / Runbooks

- (2026-02-09) Inspect plans: `ls -la ee/docs/plans`
- (2026-02-09) Read related plan: `sed -n '1,220p' ee/docs/plans/2026-02-05-ticket-response-source/PRD.md`
- (2026-02-09) Locate source hints: `rg -n "source: 'web_app'|source: 'client_portal'|source: 'email'" packages shared`
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
- `packages/tickets/src/components/ticket/TicketDetails.tsx`
- `packages/client-portal/src/components/tickets/TicketDetails.tsx`
- `packages/tickets/src/components/ResponseSourceBadge.tsx`
- `packages/tickets/src/components/ResponseStateBadge.tsx`

## Open Questions

- Confirm label copy for internal origin: `Created Internally` vs `Created by MSP`.
- Confirm whether ticket list/table should show origin in this phase.
- Confirm whether inbound email badge should remain generic or include provider detail.
- Confirm how to classify API/workflow-created tickets beyond MSP/client/email (defaulting to internal unless instructed otherwise).

## Implementation Log

- (2026-02-09) **F001 completed**: Added canonical ticket origin constants in `packages/types/src/interfaces/ticket.interfaces.ts`:
  - `TICKET_ORIGINS.INTERNAL = 'internal'`
  - `TICKET_ORIGINS.CLIENT_PORTAL = 'client_portal'`
  - `TICKET_ORIGINS.INBOUND_EMAIL = 'inbound_email'`
- (2026-02-09) Validation command: `npx vitest run packages/types/src/interfaces/barrel.test.ts` (fails due to pre-existing unrelated `tax.interfaces` barrel mismatch).
- (2026-02-09) **F002 completed**: Added shared `TicketOrigin` union type and `ITicket.ticket_origin?: TicketOrigin` in `packages/types/src/interfaces/ticket.interfaces.ts` for ticket-level origin typing across packages.
- (2026-02-09) **F003 completed**: Added shared resolver `getTicketOrigin` in `packages/tickets/src/lib/ticketOrigin.ts` and exported it via `packages/tickets/src/lib/index.ts`. Resolver precedence is explicit and deterministic: `email_metadata` -> source hint mapping -> creator user type -> internal fallback.
- (2026-02-09) **F004 completed**: `getTicketOrigin` now gives highest precedence to `email_metadata` presence and classifies as `inbound_email` before any source/user-type checks.
