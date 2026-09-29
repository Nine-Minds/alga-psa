# Scratchpad — bundle mirrored comment author (alga-2026-0002509)

## Pointers

- Card: e8c06c2b-0a71-4098-af4f-7c29aef4b631 (Alga Task Office); worktree `~/alga-copies/feature-ticket-bundles-mirrored-child-comments-show-unkn`, branch `feature/ticket-bundles-mirrored-child-comments-show-unkn`, dev port 3707, compose project `alga-psa-local-test`.
- Spec: internal comment on ticket alga-2026-0002509.
- Prior art: `ee/docs/plans/2026-01-04-ticket-bundling/` (original bundling PRD), `ee/docs/plans/2026-09-04-ticket-comment-attachments/REVIEW.md` (bundled-child email authorization model), commit `dfc618e264`.

## Key files

- Mirror insert: `packages/tickets/src/actions/optimizedTicketActions.ts` — `addTicketCommentWithCache`, block starting "If this is a bundle master in sync_updates mode, mirror public comments" (~L3350–3420). Master row is `newComment` from `.returning('*')`, so all author fields are on hand.
- Author resolution: `packages/tickets/src/lib/commentAuthorResolution.ts` (`UNKNOWN_AUTHOR` when both `user_id` and `contact_id` null).
- Rendering: `packages/tickets/src/components/ticket/CommentItem.tsx` — `getAuthorName` (L~226 short-circuits to `conversation.bundledUpdate`), `getAuthorEmail` (L~246), avatar branch (L~475), `canEdit` (L~263).
- Pass-through hosts: `TicketConversation.tsx` (two `<CommentItem>` sites ~L498, ~L618), `bento/BentoTimelineTile.tsx` (~L707). Portal reuses `TicketConversation` from `@alga-psa/tickets/components` (`packages/client-portal/src/components/tickets/TicketDetails.tsx` ~L866).
- Master reference on the MSP side: `TicketDetails.tsx` has `bundle` state (`bundle.isBundleChild`, `bundle.masterTicket.{ticket_id,ticket_number}`), already used for the child banner (~L3240) and time-entry context (~L2436).
- User maps: MSP `getTicketDetails` adds `extraCommentAuthors` for every `comments.user_id` (~L750); portal `getClientTicketDetails` `usersQuery` includes `commentUserIdsSubquery` (~L383). Both build `contactMap` from `comments.contact_id`. → No fetch changes needed.
- Email fanout: `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` `handleTicketCommentAdded` (~L2780–2830) builds child emails from the *master* event; author name = `payload.comment.author` (already the master author); `commentSource = {master ticket, master comment}`, `replyContext.ticketId = child`. `server/src/lib/notifications/sendEventEmail.ts` (~L380–400) resolves `mirror.child_comment_id` for the reply token and re-checks `tickets.master_ticket_id`. Neither reads the child row's `user_id`.
- Immutability: `packages/tickets/src/actions/comment-actions/commentActions.ts` L554/L754 (`is_system_generated` → reject), `server/src/lib/api/services/TicketService.ts` ~L2526 (same).
- Schema: `server/migrations/20260104120000_create_ticket_bundles.cjs` (mirrors table: PK `(tenant, source_comment_id, child_ticket_id)`, unique `(tenant, child_comment_id)`), `20250217202535_create_new_comment_author_type.cjs` (enum `internal|client|unknown`), `20260513100800_distribute_email_reply_tokens.cjs` (mirrors distributed on tenant). Backfill precedent: `20260513100500_backfill_comment_threads.cjs`.
- Contract test asserting structural tenant scoping of the mirror block: `packages/tickets/src/actions/optimizedTicketActions.tenantScopedAuth.contract.test.ts` (~L208) — keep `tenantScopedTable(trx, 'ticket_bundle_mirrors', tenant)` intact.

## Discoveries

- Only one mirror path exists: the optimized MSP add-comment action. `commentActions.createComment`, the portal `addClientTicketComment`, and `TicketService` do not mirror. Scheduled comments are never mirrored at publish time (out of scope; worth its own card).
- Because portal replies do not mirror, mirrored rows are effectively always agent-authored (`author_type: 'internal'`). Copy `contact_id` anyway for fidelity.
- The child email already names the master author (from the event payload). The requirement "child email names the author" is therefore locked in by test rather than fixed by code. The actual authorless surfaces are: MSP conversation/timeline, client portal, comments API.
- `CommentItem` uses `is_system_generated` (not `user_id == null`) for edit gating; `TicketService.updateComment` checks `is_system_generated` before its `user_id == null` operator-repair branch. `commentActions.ts` L38 response-state gate uses `author_type !== 'internal' || is_system_generated`. Audit remaining readers during implementation (F020).
- `conversation.bundledUpdate` exists in all 10 locale files (`server/public/locales/*/features/tickets.json`).
- Cross-client bundles exist (`bundleHasMultipleClients` in TicketDetails) → portal badge must not link to the master.

## Decisions

- Copy author fields from the inserted master row (`newComment`), not from the `user` arg — child is a faithful copy of the source row.
- Badge is additive: author name/avatar/email render normally; badge sits in the existing badge row next to the name. Fallback to legacy rendering only when the author is unresolvable.
- Master link plumbed via an optional `bundleMaster` prop from MSP `TicketDetails`; portal supplies nothing (label only).
- Migration: tenant-co-located `UPDATE … FROM` with `IS NULL` guards; reversible `down` scoped through `ticket_bundle_mirrors`.
- No new event, no publication row, no response-state or reopen side effects for the child copy.

## Commands

```bash
# integration tests (DB-backed) — from server/
npx vitest run src/test/integration/ticketBundling.integration.test.ts
npx vitest run src/test/integration/ticketBundlingEmailFanout.integration.test.ts
# package unit tests — from packages/tickets/
npx vitest run src/components/ticket
# migration (dev stack)
cd server && npx knex migrate:latest --env migration
```

## Gotchas

- Citus: a 3-table `UPDATE comments c … FROM ticket_bundle_mirrors m, comments s` self-joins the distributed `comments` table; if the planner rejects it, split into a temp/CTE-free two-step per the comment-threads backfill comment ("Citus does not reliably run multi-table WITH…INSERT…UPDATE").
- Do not touch `commentSource` / `replyContext` wiring in the subscriber — the 2026-09-05 review established that model; this card only proves it still holds.

## Implementation notes (2026-09-18)

- Master insert (`addTicketCommentWithCache`) now records `comments.contact_id = user.contact_id ?? null` so the source row can actually carry a contact author for F002/T002; the mirror then copies it. `newComment` is `returning('*')`, so both fields are on hand. No email path reads `comments.contact_id` (the subscriber joins `users.contact_id`), so this is inert for notifications.
- F020 audit found no reader that infers "mirrored" from `user_id IS NULL`: `commentActions.updateComment` and `TicketService.updateComment` both gate on `is_system_generated` first; the client-create ownership check and `CommentItem.canEdit` are ownership gates, not mirror detection. No code changed.
- The mirror still publishes nothing for the child; a passed `addTicketCommentWithCache` also emits `TICKET_RESPONSE_STATE_CHANGED` via the response-state updater, so the guard test filters to `TICKET_COMMENT_ADDED` rather than asserting a total call count.
- `T006` is implemented as a dedicated portal test (`ticketBundlingPortalAuthor.integration.test.ts`) that mocks RBAC and asserts `getClientTicketDetails(child).userMap` resolves the agent via `resolveCommentAuthor`. `T003` lives in `bundleMirrorCommentAuthorBackfill.integration.test.ts`.
- Local integration runs need the real DB password env (`DB_PASSWORD_SERVER`/`DB_PASSWORD_ADMIN` from `secrets/`); `.env.localtest` leaves them as `/run/secrets/...` paths, which the mocked-`getSecret` suites otherwise treat literally.

