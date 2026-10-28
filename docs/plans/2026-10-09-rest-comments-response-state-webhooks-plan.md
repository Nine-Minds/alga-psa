# REST comments → response_state; richer ticket webhooks

Implementation plan. Card c219d6bf. Date 2026-10-09.

## Problem

Comments posted through `POST /api/v1/tickets/{id}/comments` do not behave like
comments posted in the UI: `author_type` stays at the DB default (`unknown`) and
`response_state` is never updated, so a reply posted by an external tool leaves the
ticket marked as waiting on us. Separately, the outbound webhooks never announce a
response-state change, so an external inbox (Biz Buddy) cannot tell whose turn it is.

## Changes

### 1. One shared "comment added" path sets author_type + response_state
- UI path today: `packages/tickets/src/actions/comment-actions/commentActions.ts`
  sets `author_type` (~249-265) and updates `response_state` (~146-171).
- Extract that into one reusable helper and call it from BOTH the UI action and the
  REST service, instead of copying the rules into the API service.
- REST path today: `TicketService.addComment` in
  `server/src/lib/api/services/TicketService.ts` (~2539) inserts the comment but only
  reads `author_type` (~2432) — it never updates `response_state`.
  After insert: derive `author_type` from the authenticated actor (internal staff vs
  client) and invoke the shared response-state updater.
- Rules (migration `server/migrations/20260104120000_add_response_state_to_tickets.cjs`):
  internal note → no change; client-visible staff comment → `awaiting_client`; client
  comment → `awaiting_internal`; closing the ticket clears it. Honour the per-tenant
  tracking setting in `packages/tickets/src/lib/responseStateSettings.ts`.

### 2. Webhook event: ticket.response_state_changed
- `TICKET_RESPONSE_STATE_CHANGED` already exists on the event bus but is not mapped in
  `server/src/lib/eventBus/subscribers/webhook/webhookEventMap.ts`.
- Map it to `ticket.response_state_changed`, carrying `previousState`, `newState`
  (and `ticketId`).
- Make it selectable in the webhook event list (allowed-events constant / UI picker).
- Additive and back-compatible: existing subscribers are unaffected.

### 3. Tests
- REST `addComment` sets `author_type` and updates `response_state` per the rules;
  internal note is a no-op; per-tenant setting respected.
- Webhook emits `ticket.response_state_changed` with previous + new state.

## Order
1. Shared response-state helper (extract from commentActions).
2. Wire REST `TicketService.addComment` to it and set `author_type`.
3. Webhook event map + selectable event list.
4. Tests.

## Deliberately NOT doing
- Not changing client-portal / inbound-email paths beyond adopting the shared helper.
- No new response_state values and no schema migration.
- No webhook payload redesign beyond adding this event.
- No implementation here — the Draft Implementation agent executes this plan.

## Risks / edge cases
- Double emission if both a DB trigger and the application emit the event — confirm a
  single source of truth before wiring the webhook.
- `author_type` for API-token / service actors must be defined (staff key → internal).
- Per-tenant tracking disabled → skip both the state update and the event.
- Confirm the closing-clears-state path still works for API-driven closes.
- Webhook consumers must tolerate the new event with an unchanged envelope.

## Code-claim confirmation (read on the branch worktree)
- `commentActions.ts` UI path sets `author_type` + `response_state` — CONFIRMED.
- `TicketService.addComment` does not update `response_state` — CONFIRMED (only reads
  `author_type` at ~2432).
- `webhookEventMap.ts` has no response-state mapping — CONFIRMED (no match).
