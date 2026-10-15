# Ticket bundles: mirrored child comments carry the source author

**Ticket:** alga-2026-0002509 (related: alga-2026-0002507, alga-2026-0002508 — same propagation code)
**Status:** draft — awaiting scope confirmation (see Open Questions)
**Plan folder:** `ee/docs/plans/2026-09-18-bundle-mirrored-comment-author/`

## Problem statement

When a bundle master is in `sync_updates` mode, every public comment added on the master is copied onto each child ticket. The copy is inserted with `user_id: null`, `author_type: 'unknown'`, `is_system_generated: true`, and its `comment_threads` row with `created_by: null`. `resolveCommentAuthor` returns the "Unknown User" placeholder whenever both `user_id` and `contact_id` are null, so the child copy renders as authorless in the MSP conversation view, the timeline tile, the client portal, and the public comments API — while the master shows the real author.

The true author is recoverable (`ticket_bundle_mirrors.child_comment_id → source_comment_id`) but nothing reads the link for display.

Users affected: every tenant using sync-mode bundles. Requesters on child tickets see updates from "Unknown User"; technicians opening a child cannot tell who wrote the update.

## Goals

1. A mirrored comment carries the source comment's author (`user_id`, `contact_id`, `author_type`) and its thread root carries `created_by`, so it resolves to the real author everywhere `resolveCommentAuthor` is used — MSP conversation, bento timeline, client portal, comments API.
2. A mirrored comment is visibly marked as a bundled update next to (not instead of) the author, linking to the master ticket where the viewer can reach it.
3. Existing mirrored comments are backfilled from their source via `ticket_bundle_mirrors`.
4. The bundled-child email path is unchanged in *what it authorizes*: the child email is still addressed to the child's requester, authorized against the child ticket, with the master comment as its source, authored by the master's author. Setting an author on the child row must not create a second notification or alter recipient selection.
5. Tests lock all of the above in.

## Non-goals

- Changing bundle propagation semantics (which comments mirror, when, or to whom). alga-2026-0002507 / -0002508 cover close/reopen behaviour and are separate cards.
- Mirroring scheduled comments at publish time (today the mirror only runs on the immediate add path; scheduled publication is not mirrored). Recorded in the scratchpad as a discovery; out of scope here.
- Mirroring client-portal replies (portal comments use `addClientTicketComment`, which never mirrors). Out of scope.
- Making mirrored comments editable/deletable on the child. They stay `is_system_generated: true` and immutable.
- Mirroring reactions, attachments, or external links onto the child copy.

## Personas and flows

- **Technician (MSP):** opens a child ticket → sees the mirrored update under the agent's name and avatar with a "Bundled update" badge linking to the master.
- **Requester (client portal):** opens their ticket → sees the update under the agent's name, with the "Bundled update" label (no link; the master may belong to another client).
- **Requester (email):** receives the child notification exactly as today — named author, child ticket number, child reply threading.
- **API consumer:** `GET /api/v1/tickets/{childId}/comments` returns `user_id` / `created_by_name` for mirrored rows.

## Design

### 1. Mirror insert carries the author (`packages/tickets/src/actions/optimizedTicketActions.ts`, sync_updates block of `addTicketCommentWithCache`)

Copy from the just-inserted master row (`newComment`, already `returning('*')`), not from the `user` argument, so the child is a faithful copy of whatever the source row says:

- `comments.user_id ← newComment.user_id`
- `comments.contact_id ← newComment.contact_id ?? null`
- `comments.author_type ← newComment.author_type`
- `comment_threads.created_by ← newComment.user_id ?? null`
- keep `is_system_generated: true`, `is_internal: false`, `is_resolution`, `note`, `markdown_content`, and the `ticket_bundle_mirrors` row exactly as today.

Nothing else on the mirror path changes: no publication row, no `TICKET_COMMENT_ADDED` for the child, no response-state update, no reopen check. The child copy remains a display artifact of the master's comment.

### 2. "Bundled update" label next to the author (`CommentItem.tsx`)

Today `is_system_generated` short-circuits `getAuthorName()` to the label, hides the email, and forces the placeholder avatar. New behaviour:

- Author name, email, and avatar come from `resolvedAuthor` like any other comment.
- When `conversation.is_system_generated` is true, render a small badge with the existing `conversation.bundledUpdate` string next to the author name (same row as the internal lock / resolution badges). If a master ticket reference is available, the badge is a link to `/msp/tickets/{masterTicketId}` (with `masterTicketNumber` in the tooltip/title); otherwise it is a plain badge.
- Fallback: if `is_system_generated` and `resolvedAuthor.source === 'unknown'` (legacy row not yet backfilled, or source author deleted), keep today's rendering — label as the name, placeholder avatar, no email — so nothing regresses before/without the backfill.
- No behavioural change for non-mirrored comments.

Master reference plumbing: `CommentItem` gains an optional `bundleMaster?: { ticketId: string; ticketNumber: string | null }` prop. `TicketConversation` and `BentoTimelineTile` accept the same optional prop and pass it through. MSP `TicketDetails` supplies it from `bundle?.masterTicket` when `bundle?.isBundleChild`. The client portal does not supply it (label only).

### 3. Backfill migration (`server/migrations/<ts>_backfill_bundle_mirror_comment_authors.cjs`)

Citus-safe, tenant-co-located `UPDATE ... FROM`, following `20260513100500_backfill_comment_threads.cjs`:

- `comments` (child) ← `ticket_bundle_mirrors` ← `comments` (source), joined on `tenant`; set `user_id`, `contact_id`, `author_type` on child rows where `is_system_generated` and `user_id IS NULL AND contact_id IS NULL`.
- `comment_threads.created_by` for the child thread root where `created_by IS NULL`, from the source comment's `user_id`.
- Idempotent (the `IS NULL` guards make reruns no-ops). `down` reverts only rows reachable through `ticket_bundle_mirrors` (sets author fields and `created_by` back to null, `author_type` back to `'unknown'`).

### 4. Email authorization path — unchanged, and proven unchanged

`handleTicketCommentAdded` fans out to children from the **master** event using `payload.comment.id` (the source) as `commentSource` and the child ticket as `replyContext.ticketId`; `sendEventEmail` then resolves the child comment id from `ticket_bundle_mirrors` and re-checks that the child still references the master. None of that reads the child row's `user_id`. The author string in the email already comes from the master payload. This card adds no code there; it adds a test that seeds mirror rows *with* an author and asserts the child email's recipient, entity, reply context, and author name.

A short audit confirms no reader infers "this is a mirrored comment" from `user_id IS NULL` instead of `is_system_generated` / the mirrors table (known spots: `commentActions.ts` response-state gate, `TicketService.updateComment` operator-repair branch, `CommentItem.canEdit`). Any such inference found is switched to `is_system_generated`.

## Data model / API notes

- No schema changes. `comments.contact_id`, `comments.author_type` (`comment_author_type` enum: internal | client | unknown), `comment_threads.created_by`, and `ticket_bundle_mirrors` already exist and are distributed on `tenant`.
- Public API: `GET /tickets/{id}/comments` shape is unchanged; mirrored rows now populate `user_id`, `created_by`, `created_by_name`, `created_by_avatar_url` via the existing user join.
- The MSP `getTicketDetails` and portal `getClientTicketDetails` user maps already include every `comments.user_id` on the ticket, so no fetch changes are required for the author to resolve.

## UX copy

Reuse `tickets:conversation.bundledUpdate` ("Bundled update"), present in all 10 locale files. No new strings unless the badge tooltip needs one (e.g. "Mirrored from master ticket {{number}}") — decide during implementation; if added, add to all locale files.

## Risks

- **Backfill on Citus:** a three-table `UPDATE … FROM` (child ← mirrors ← source comments) must stay co-located on `tenant`. Follow the two-statement pattern from the comment-threads backfill if the planner rejects the self-join.
- **Cross-client bundles:** a child requester from another client now sees the agent's name (as intended). Mirrored comments are only ever agent-authored (portal replies do not mirror), so no contact-to-contact name leakage arises; the badge in the portal carries no link because the master may be invisible to that client.
- **Readers keyed on `user_id IS NULL`:** covered by the audit in §4.
- **Legacy rows before the backfill runs:** the fallback rendering keeps today's behaviour.

## Rollout / migration

Ship code + migration together; the migration is idempotent and safe to rerun. No feature flag.

## Open questions

1. Badge placement: inline chip after the author name (proposed), or a line under the name? Proposed: inline chip, matching the existing internal/resolution badge row.
2. Should the portal badge link to the master when the master belongs to the *same* client? Proposed: no link in the portal for now (keeps the portal path free of bundle lookups); revisit if requested.
3. Does the `down` migration need to exist at all, or is a no-op down acceptable per repo convention? Proposed: reversible down via the mirrors table (cheap, exact).

## Acceptance criteria / definition of done

- [ ] Adding a public comment on a sync-mode master produces child rows whose `user_id`, `contact_id`, `author_type` equal the source's and whose thread `created_by` equals the source author; `is_system_generated` remains true and the mirrors row exists.
- [ ] Child ticket in MSP shows the author's name + avatar and a "Bundled update" badge linking to the master; the comment remains non-editable.
- [ ] Child ticket in the client portal shows the author's name and the "Bundled update" label.
- [ ] `GET /api/v1/tickets/{child}/comments` returns the author for mirrored rows.
- [ ] Migration backfills all existing mirrored rows from their source; rerun is a no-op.
- [ ] Bundled-child email: recipient = child requester, `entityId`/`replyContext.ticketId` = child, `commentSource` = master comment, author name = master author; exactly one notification event is published (for the master).
- [ ] Integration tests in `ticketBundling.integration.test.ts` and a notification test cover the above; unit test covers `CommentItem` rendering states.
