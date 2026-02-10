# PRD — Ticket Origin Badge (Internal, Client Portal, Inbound Email, API)

- Slug: `2026-02-09-ticket-origin-badge`
- Date: `2026-02-09`
- Status: Draft

## Summary

Add a ticket-level origin badge so users can see where a ticket was created:

- `Internal (MSP)`
- `Client Portal`
- `Inbound Email`
- `API`

The badge should be visible in ticket details and should work consistently for both MSP and client portal views.

## Problem

Today, users can see ticket response state and per-comment response source, but not the ticket creation origin at a glance. This makes triage and context handoff slower, especially when teams handle mixed intake channels.

## Goals

- Show a clear ticket origin badge in ticket details.
- Support four first-class origins: `internal`, `client_portal`, `inbound_email`, `api`.
- Persist ticket origin at creation time so we do not rely only on heuristics.
- Keep a fallback resolver for legacy tickets created before origin persistence.
- Keep origin storage extensible for future values (for example `ai_agent`) without schema redesign.

## Non-goals

- No ticket list/table filtering by origin in this phase.
- No redesign of ticket details layout beyond adding the badge.
- No changes to existing per-comment `responseSource` badges in conversation.
- No analytics/reporting dashboard for ticket origin in this phase.

## Users and Primary Flows

### Flow A — MSP user creates a ticket internally

1. Internal user creates ticket from MSP app (`addTicket` / related internal flows).
2. Ticket origin resolves to `internal`.
3. Badge shows internal origin in ticket details.

### Flow B — Client creates a ticket in client portal

1. Client user creates ticket from client portal (`createClientTicket`).
2. Ticket origin resolves to `client_portal`.
3. Badge shows client portal origin in ticket details.

### Flow C — Inbound email creates a new ticket

1. Inbound email processing creates ticket (`processInboundEmailInApp` / `createTicketFromEmail`).
2. Ticket origin resolves to `inbound_email`.
3. Badge shows inbound email origin in ticket details.

### Flow D — External integration creates a ticket through API

1. API request creates ticket (`POST /api/v1/tickets` -> `ApiTicketController` -> `TicketService`).
2. Ticket origin resolves to `api`.
3. Badge shows API origin in ticket details.

## UX / UI Notes

- Badge is ticket-level (not per-comment) and indicates creation origin.
- Placement:
  - MSP: in `packages/tickets/src/components/ticket/TicketDetails.tsx` header, near ticket number and response-state badge.
  - Client portal: in `packages/client-portal/src/components/tickets/TicketDetails.tsx` header/status area.
- Proposed labels:
  - `Created Internally`
  - `Created via Client Portal`
  - `Created via Inbound Email`
  - `Created via API`
- Badge should always render exactly one origin value for valid tickets.
- Unknown future origin values should render safely with a generic fallback label (`Created via Other`) until a specific label is added.

## Requirements

### Functional Requirements

- Add persistent `ticket_origin` field on `tickets` table (text).
- Canonical first-class values for this phase: `internal | client_portal | inbound_email | api`.
- Add a shared normalization/helper (`normalizeTicketOrigin` / `getTicketOrigin`) used by both MSP and client portal details paths.
- Origin resolution precedence for reads:
  1. If `tickets.ticket_origin` exists, use it.
  2. Else use legacy fallback resolver (email metadata, creator user type, etc.).
  3. Else resolve `internal`.
- Set `ticket_origin` explicitly on create paths:
  - MSP app creates -> `internal`
  - Client portal creates -> `client_portal`
  - Inbound email creates -> `inbound_email`
  - API creates -> `api`
- Ensure ticket detail actions return derived origin for UI consumption:
  - `packages/tickets/src/actions/ticketActions.ts#getTicketById`
  - `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts#getClientTicketDetails`
- Add a shared `TicketOriginBadge` component in `@alga-psa/tickets/components`.
- Render badge in both ticket detail UIs using shared labels/translation keys.
- Keep existing comment-level response source behavior unchanged.

### Non-functional Requirements

- Backward compatible with existing tickets (legacy tickets without `ticket_origin` still resolve correctly).
- No additional heavy queries; origin derivation should be O(1) per ticket details load.
- Resolver must be deterministic and unit-testable.

## Data / API / Integrations

- Existing signals already available in current codebase:
  - `tickets.email_metadata` (inbound email-created tickets)
  - `tickets.entered_by` + creator `users.user_type`
  - Existing create path context:
    - MSP app currently passes `source: 'web_app'`
    - Client portal passes `source: 'client_portal'`
    - Inbound email paths pass `source: 'email'`
    - API service passes `source: 'api'`
- Existing code pointers:
  - Internal create: `packages/tickets/src/actions/ticketActions.ts`
  - Client portal create: `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
  - Inbound email create: `shared/services/email/processInboundEmailInApp.ts`, `shared/workflow/actions/emailWorkflowActions.ts`
  - API create: `server/src/app/api/v1/tickets/route.ts`, `server/src/lib/api/services/TicketService.ts`

## Security / Permissions

- No new permissions required.
- Origin badge displays metadata about ticket origin only; it does not expose sensitive payloads.

## Observability

- No new metrics/logging required for MVP.

## Rollout / Migration

- DB migration to add `tickets.ticket_origin`.
- Data backfill (migration or one-time script) for existing rows:
  - `email_metadata` present -> `inbound_email`
  - creator user type `client` -> `client_portal`
  - otherwise -> `internal`
- Keep legacy fallback resolver in code as a safety net.

## Open Questions

1. Confirm final internal label copy: `Created Internally` vs `Created by MSP`.
2. Should this badge remain ticket-details-only, or also appear in ticket list rows now?
3. Should inbound email badge stay generic, or include provider label (`Gmail`, `Microsoft`, `IMAP`) in this phase?
4. For future origins like `ai_agent`, should we show raw value with title-case fallback or keep a strict whitelist + generic `Other` label?
5. Do we want to expose ticket origin in exports/reporting in this phase (currently no)?

## Acceptance Criteria (Definition of Done)

- New ticket created internally shows `internal` origin badge in MSP ticket details.
- New ticket created in client portal shows `client_portal` origin badge in both MSP and client portal ticket details.
- New inbound email-created ticket shows `inbound_email` origin badge in ticket details.
- New API-created ticket shows `api` origin badge in ticket details.
- Legacy tickets still render a stable origin badge using fallback rules.
- Existing comment response-source badge behavior is unchanged.
