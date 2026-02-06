# PRD — Ticket Response Source (Client Portal vs Inbound Email)

- Slug: `2026-02-05-ticket-response-source`
- Date: `2026-02-05`
- Status: Draft

## Summary

Add a clear indicator in ticket details so staff and clients can see how the latest customer response was received:

- `Client Portal`
- `Inbound Email`

This should work for inbound email replies processed from Google, Microsoft, and IMAP pipelines.

## Problem

`response_state=awaiting_internal` tells us that a customer responded, but not where the response came from. Support agents currently cannot quickly tell whether the customer replied in the portal or by email, which slows triage and context switching.

## Goals

- Show response source in:
  - `packages/tickets/src/components/ticket/TicketDetails.tsx`
  - `packages/client-portal/src/components/tickets/TicketDetails.tsx`
- Distinguish at minimum:
  - `client_portal`
  - `inbound_email`
- Ensure new comments created by client-portal actions and inbound email processing paths are source-identifiable.
- Keep solution backward-compatible for existing comments that do not yet have explicit source metadata.

## Non-goals

- No redesign of ticket conversation UI.
- No historical backfill migration for all legacy comments in this phase.
- No dashboard/list filtering by response source in this phase.
- No provider-level analytics or reporting.

## Users and Primary Flows

### Flow A — Client replies in client portal

1. Client posts comment in portal ticket details.
2. Comment is stored with response source metadata (`client_portal`).
3. Ticket details show "Received via Client Portal" for latest customer response.

### Flow B — Customer replies via inbound email (Google/Microsoft webhook)

1. Email webhook is processed.
2. Email reply is added to ticket comment stream.
3. Comment is stored with response source metadata (`inbound_email`) and provider details when available.
4. Ticket details show "Received via Inbound Email".

### Flow C — Customer replies via IMAP-based inbound processing

1. IMAP pipeline produces inbound email processing event.
2. Email reply creates ticket comment with response source metadata (`inbound_email`).
3. Ticket details show "Received via Inbound Email".

## UX / UI Notes

- Place source indicator adjacent to existing response-state indicator in ticket details header/status area.
- Wording:
  - MSP: `Received via Client Portal` / `Received via Inbound Email`
  - Client portal: client-friendly wording can reuse same label unless product wants alternate phrasing.
- Display only when there is a detectable latest customer response source.
- If source cannot be determined, hide source indicator (no error/placeholder).

## Current System Notes (Code Pointers)

- Ticket details UIs:
  - `packages/tickets/src/components/ticket/TicketDetails.tsx`
  - `packages/client-portal/src/components/tickets/TicketDetails.tsx`
- Shared conversation/comment rendering:
  - `packages/tickets/src/components/ticket/TicketConversation.tsx`
  - `packages/tickets/src/components/ticket/CommentItem.tsx`
- Client portal comment creation:
  - `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts` (`addClientTicketComment`)
- Inbound email processing:
  - `shared/services/email/processInboundEmailInApp.ts`
  - `shared/workflow/actions/emailWorkflowActions.ts` (`createCommentFromEmail`)
- Comment type currently lacks metadata typing:
  - `packages/types/src/interfaces/comment.interface.ts`

## Requirements

### Functional Requirements

- Add/standardize response source metadata on comment creation:
  - Client portal comments: `metadata.responseSource = "client_portal"`
  - Inbound email comments: `metadata.responseSource = "inbound_email"`
- Preserve email-specific metadata (already present) and include provider type where available (`google|microsoft|imap`).
- Add shared helper to derive latest customer response source from conversations with fallback logic:
  - Prefer explicit `metadata.responseSource`.
  - Fallback for legacy records:
    - `metadata.email` present => `inbound_email`
    - `author_type=client` and `user_id` present => `client_portal`
- Render source badge/text in both ticket details screens.
- Only consider public customer responses (exclude internal notes).

### Type Requirements

- Extend `IComment` typing to include optional `metadata` with safe loose typing, plus optional normalized source field used by UI helpers.

### Backward Compatibility Requirements

- Existing tickets/comments must continue to render without migrations.
- No required schema changes for MVP (reuse `comments.metadata` JSONB).

## Risks

- Legacy comments may be source-ambiguous without explicit metadata.
- Inbound email provider detail may be absent on older records (show generic inbound label).

## Rollout / Migration

- No DB migration required for MVP.
- Ship as additive UI + metadata writes for new comments.
- Optional follow-up: backfill script for historical comments if needed.

## Open Questions

1. Should source indicator appear only when `response_state = awaiting_internal`, or whenever latest customer response source is detectable?
2. Do we want provider-specific label now (e.g., `Inbound Email (Microsoft)`), or generic `Inbound Email` only?
3. Do we want a per-comment source badge in conversation now, or only the ticket-level source indicator?
4. Should we backfill historical comments for better accuracy, or accept heuristic fallback for old data?
5. Should this source be exposed in ticket list/table views in this phase?

## Acceptance Criteria (Definition of Done)

- A new client-portal comment causes ticket details to display source as `Client Portal`.
- A new inbound email reply (Google/Microsoft/IMAP) causes ticket details to display source as `Inbound Email`.
- Existing tickets with historical comments continue to load with no regression.
- If source cannot be confidently resolved, UI remains stable and omits source indicator.
- Both target surfaces reflect the same source-resolution behavior.
