# Scratchpad — Ticket comment order browser preference

- Plan slug: `ticket-comment-order-browser-preference`
- Created: `2026-03-09`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-03-09) Persist ticket comment order per browser with `localStorage`, not backend `user_preferences`, because the approved scope only requires per-browser memory.
- (2026-03-09) Keep `defaultNewestFirst` as the fallback when no browser value exists so current server-provided defaults continue to work.
- (2026-03-09) Read the saved browser value in a mount-time `useEffect` instead of the initial state initializer to avoid server/client hydration mismatch risk.

## Discoveries / Constraints

- (2026-03-09) `TicketConversation` already centralizes both standard and external comment ordering behind the same `reverseOrder` state.
- (2026-03-09) The repo already has server-backed user preference infrastructure, but it is unnecessary for this scope and would over-expand the change.
- (2026-03-09) The shared Vitest setup does not expose a DOM-style `localStorage`, so these tests need an explicit test-local storage mock.

## Commands / Runbooks

- (2026-03-09) `npx vitest run packages/tickets/src/components/ticket/TicketConversation.commentOrderPreference.test.tsx packages/tickets/src/components/ticket/ticketConversationOrderPreference.test.ts`
- (2026-03-09) `cd server && npx vitest run --config vitest.config.ts ../packages/tickets/src/components/ticket/ticketConversationOrderPreference.test.ts ../packages/tickets/src/components/ticket/TicketConversation.commentOrderPreference.test.tsx`

## Links / References

- `packages/tickets/src/components/ticket/TicketConversation.tsx`
- `packages/user-composition/src/hooks/useUserPreferencesBatch.ts`

## Open Questions

- None.
