# Scratchpad — Threaded Comment Responses

- Plan slug: `2026-05-13-threaded-comments`
- Created: `2026-05-13`

## What This Is

Working notes for implementing nested/threaded comment responses on tickets and project tasks, plus the supporting first-class `comment_threads` entity that carries email-thread identity. See `PRD.md` for scope, `features.json` for the commit-sized work list, `tests.json` for the test plan.

## Decisions

- (2026-05-13) **Thread as first-class entity.** Every top-level comment is the head of a `comment_threads` row. Inbound/outbound email correlation happens at thread granularity, not ticket. New "Add Comment" always creates a new thread; existing flat comments backfill as single-comment threads.
- (2026-05-13) **F001 migration split.** Created `comment_threads` in `20260513100000_create_comment_threads.cjs` with only the base table, parent CHECK, and ticket/task FKs. Deferred indexes, comment-column FKs, and backfill to their own checklist migrations to preserve the PRD's staged rollout and make each commit reviewable.
- (2026-05-13) **Hybrid (Nested + collapsible drawer)** is the only production reply model. Other modes from the prototype (Flat, Single-level only, Deep nesting only, Quote-reply, Side-panel only) are exploration-only and not shipping. The prototype's Tweaks panel is not part of production.
- (2026-05-13) **Scope:** Tickets + project tasks together in one PR. Email integration is full bidirectional (inbound matching + outbound RFC headers + reply tokens) for tickets only — tasks don't accept inbound email today.
- (2026-05-13) **Backfill model:** one thread per existing comment. Cleanest cut-over; visually identical to today (no thread bars on legacy comments).
- (2026-05-13) **Depth cap:** visual indent capped at 4 levels (matches the design prototype); data has no cap so the model accommodates real-world deep threads.
- (2026-05-13) **Soft-delete only for roots with children.** Leaf comments hard-delete as today. Soft-delete = `deleted_at` set + `note = '[deleted]'`. Keeps tree well-formed without orphaning children.
- (2026-05-13) **Visibility invariant:** a thread's `is_internal` flag denormalizes from its root. Reply must be compatible with root (can't make a reply client-visible inside an internal thread, etc.). Inbound emails inherit thread visibility — clients can only reply to client-visible threads.
- (2026-05-13) **Inbound resolution precedence:** reply-token > In-Reply-To > References (end→start) > provider thread id > ticket-fallback (new top-level thread). First match wins.

## Discoveries / Constraints

- (2026-05-13) **F002 indexes.** Added `20260513100500_add_comment_threads_indexes.cjs` with `comment_threads_ticket_idx`, `comment_threads_task_idx`, and partial `comment_threads_email_msgid_idx`. The list indexes include `last_activity_at DESC` because thread ordering is by thread activity, not individual comment chronology.
- (2026-05-13) **F003 ticket comment columns.** Added nullable `comments.thread_id`, `comments.parent_comment_id`, and `comments.deleted_at` in `20260513101000_add_threading_columns_to_comments.cjs`. `thread_id` is intentionally nullable until the backfill and F007 enforcement migration. Added tenant-scoped FK to `comment_threads` plus self-FK for parent comments.
- (2026-05-13) **F004 project task comment columns.** Added matching nullable threading columns to `project_task_comments` in `20260513101500_add_threading_columns_to_project_task_comments.cjs`, with FK to `comment_threads` and a self-FK on `(tenant, parent_comment_id)`.
- (2026-05-13) **F005 ticket comment backfill.** Added chunked backfill in `20260513102000_backfill_comment_threads_for_comments.cjs`. Legacy ticket comments use `thread_id = comment_id`, which makes reruns idempotent via `ON CONFLICT (tenant, thread_id) DO NOTHING` and avoids a temporary mapping table. `email_message_id` is populated from `metadata->'email'->>'messageId'`.
- (2026-05-13) **F006 task comment backfill.** Added `20260513102500_backfill_comment_threads_for_project_task_comments.cjs` using the same deterministic legacy ID pattern (`thread_id = task_comment_id`). Task threads set `project_task_id`, leave `ticket_id` null, and use `is_internal=false`.
- (2026-05-13) **F007 NOT NULL enforcement.** Added `20260513103000_enforce_comment_thread_ids_not_null.cjs`. It raises a clear migration exception if either comment table still has null `thread_id` values, then alters both columns to NOT NULL.
- (2026-05-13) **F008 email log linkage.** Added nullable `email_sending_logs.comment_thread_id` in `20260513103500_add_comment_thread_id_to_email_sending_logs.cjs` with tenant-scoped FK to `comment_threads`. Left existing `email_sending_logs.thread_id` untouched as the provider thread id and added a partial `(tenant, comment_thread_id, created_at DESC)` index for outbound latest-message lookup.
- (2026-05-13) **F009 type contract.** Added `packages/types/src/interfaces/commentThread.interface.ts` with `ICommentThread` covering all `comment_threads` columns and exported it from `packages/types/src/interfaces/index.ts`. Verified with `npx tsc -p packages/types/tsconfig.json --noEmit`.
- (2026-05-13) **F010 ticket comment type fields.** Extended `IComment` with `thread_id`, `parent_comment_id`, and `deleted_at`. Kept them optional at the interface boundary because `IComment` is currently used for both persisted rows and create payloads; runtime model code will guarantee `thread_id` for persisted reads after F012-F016. Verified with `npx tsc -p packages/types/tsconfig.json --noEmit`.
- (2026-05-13) **F011 task comment type fields.** Extended `IProjectTaskComment` with camelCase `threadId`, `parentCommentId`, and `deletedAt`, matching the existing task-comment interface convention while mapping to DB columns `thread_id`, `parent_comment_id`, and `deleted_at` in actions/models. Kept fields optional for create payload compatibility. Verified with `npx tsc -p packages/types/tsconfig.json --noEmit`.
- (2026-05-13) **F012 top-level ticket comment creation.** Updated `packages/tickets/src/models/comment.ts` so top-level inserts generate `comment_id` + `thread_id`, insert `comment_threads` first, then insert `comments.thread_id` in the same transaction. Also updated `shared/models/ticketModel.ts` direct comment creation for the same NOT NULL requirement; otherwise workflow/email paths would fail after F007. Reply parent resolution remains guarded for F013. Verified with `npx tsc -p packages/types/tsconfig.json --noEmit` and `npx tsc -p packages/tickets/tsconfig.json --noEmit`.
- (2026-05-13) **F013 ticket reply parent resolution.** Updated `Comment.insert` to resolve `parent_comment_id` against the same tenant and ticket, reject soft-deleted parents, inherit the parent's `thread_id`, and default/validate `is_internal` against `comment_threads.is_internal`. Verified with `npx tsc -p packages/tickets/tsconfig.json --noEmit`.
- (2026-05-13) **F014 ticket reply counters.** `Comment.insert` now increments `comment_threads.reply_count` and updates `last_activity_at` after successful reply insert, in the same transaction supplied by the action/model caller. Verified with `npx tsc -p packages/tickets/tsconfig.json --noEmit`.
- (2026-05-13) **F015 ticket comment delete semantics.** `Comment.delete` now checks for children. Comments with children are soft-deleted with `note`/`markdown_content = '[deleted]'` and `deleted_at` set. Leaf replies hard-delete and decrement `reply_count`; leaf roots hard-delete and remove their now-empty `comment_threads` row. Verified with `npx tsc -p packages/tickets/tsconfig.json --noEmit`.
- (2026-05-13) **F016 ticket comment reads.** No code change needed: `Comment.getAllbyTicketId` already selects `comments.*`, filters only by tenant/ticket, and orders by `comments.created_at ASC`, so the new `thread_id`, `parent_comment_id`, and `deleted_at` columns are returned and soft-deleted comments remain in the result.
- (2026-05-13) **F017 top-level task comment creation.** Updated `createTaskComment` to validate the task first, generate `task_comment_id` + `thread_id`, insert `comment_threads` with `project_task_id` and `is_internal=false`, then insert `project_task_comments.thread_id` in the same transaction. Reply parent resolution remains guarded for F018. Verified with `npx tsc -p packages/projects/tsconfig.json --noEmit`.
- (2026-05-13) **F018 task reply parent resolution.** `createTaskComment` now resolves `parentCommentId`, validates the parent is on the same task and not deleted, inherits `thread_id`, and inserts the reply with `parent_comment_id`. Verified with `npx tsc -p packages/projects/tsconfig.json --noEmit`.
- (2026-05-13) **F019 task reply counters.** Task replies now increment `comment_threads.reply_count` and bump `last_activity_at` in the same transaction after successful insert. Verified with `npx tsc -p packages/projects/tsconfig.json --noEmit`.
- (2026-05-13) **F020 task comment delete semantics.** `deleteTaskComment` now soft-deletes task comments with children, hard-deletes leaves, decrements `reply_count` for leaf replies, and removes empty root thread rows. Reactions are still explicitly deleted before hard-delete for Citus compatibility. Verified with `npx tsc -p packages/projects/tsconfig.json --noEmit`.
- (2026-05-13) **F021 task comment reads.** `getTaskComments` now maps `thread_id`, `parent_comment_id`, and `deleted_at` from `project_task_comments.*` into `threadId`, `parentCommentId`, and `deletedAt` on `IProjectTaskCommentWithUser`. Verified with `npx tsc -p packages/projects/tsconfig.json --noEmit`.
- (2026-05-13) **F022 ticket create action pass-through.** No code change needed: after F010, `createComment(comment: Omit<IComment, 'tenant'>)` accepts optional `parent_comment_id`; the action copies the payload into `commentToInsert` and passes it to `Comment.insert`, which resolves the parent in F013.
- (2026-05-13) **F023 ticket comment event payload.** `TICKET_COMMENT_ADDED` now includes `thread_id`, `parent_comment_id`, and `is_reply` at the payload level and inside the legacy `comment` object. The action fetches the inserted comment after model insert so the event uses the resolved thread id. Verified with `npx tsc -p packages/tickets/tsconfig.json --noEmit`.
- (2026-05-13) **F024 ticket reply visibility enforcement.** No extra action code needed: `createComment` already rejects internal comments from non-internal authors, and F013 model enforcement rejects any reply whose `is_internal` differs from `comment_threads.is_internal` (including client-visible reply inside an internal thread and internal reply inside a client thread).
- (2026-05-13) **F025 task create action parent payload.** `createTaskComment` now accepts `parent_comment_id` in addition to camelCase `parentCommentId` and normalizes both to the same parent resolution path. Verified with `npx tsc -p packages/projects/tsconfig.json --noEmit`.
- (2026-05-13) **F026 task comment event payload.** `TASK_COMMENT_ADDED` now includes both camelCase and snake_case thread fields: `threadId`/`thread_id`, `parentCommentId`/`parent_comment_id`, and `isReply`/`is_reply`. Verified with `npx tsc -p packages/projects/tsconfig.json --noEmit`.
- (2026-05-13) **F027 task reply ownership.** No code change needed: task replies use the same `project_task_comments.user_id` ownership field as top-level comments, so `assertOwnCommentOrInternalUser` already allows internal users and the reply's owner while rejecting other client users.
- (2026-05-13) **F028 inbound reply-token thread routing.** Added `resolveReplyTargetFromComment` in `processInboundEmailInApp` so a reply token tied to a `comment_id` resolves that comment's `thread_id` and uses the latest comment in that thread as `parent_comment_id`. Extended `createCommentFromEmail` and shared `TicketModel.createComment` to create replies when `parent_comment_id` is supplied, inheriting thread visibility and incrementing counters. Verified with `npx tsc -p shared/tsconfig.json --noEmit`.
- (2026-05-13) **F029 inbound In-Reply-To routing.** Added `resolveReplyTargetFromOutboundMessageId` to look up `email_sending_logs.rfc_message_id`, read `comment_thread_id`, resolve the latest comment in that thread, and pass it as `parent_comment_id` for inbound replies. This runs before legacy ticket-level header matching. Verified with `npx tsc -p shared/tsconfig.json --noEmit`.
- (2026-05-13) **F030 inbound References routing.** Added reverse-order `References[]` lookup using the same `email_sending_logs.rfc_message_id` resolver. If `In-Reply-To` is absent or does not resolve, the first matching reference from the end of the chain routes to that comment thread. Verified with `npx tsc -p shared/tsconfig.json --noEmit`.
- (2026-05-13) **F031 inbound provider thread routing.** Added `resolveReplyTargetFromProviderThreadId`, which matches `emailData.threadId` to `comment_threads.email_provider_thread_id` for ticket threads and routes to the latest comment in that thread before falling back to legacy ticket-level matching. Verified with `npx tsc -p shared/tsconfig.json --noEmit`.
- (2026-05-13) **F032 inbound ticket fallback.** No additional code needed after F028: legacy ticket-level header matching still calls `createCommentFromEmail` without `parent_comment_id`, and shared `TicketModel.createComment` now treats that as a new top-level thread. This preserves today's ticket-level fallback while avoiding accidental attachment to an existing comment thread.
- (2026-05-13) **F033 inbound comment creation.** Thread-specific inbound resolution now always passes the latest comment in the resolved thread as `parent_comment_id`; `TicketModel.createComment` stores the inherited `thread_id` and `parent_comment_id` on the new comment. Top-level fallback omits `parent_comment_id` and creates a fresh thread.
- (2026-05-13) **F034 outbound top-level Message-ID.** `BaseEmailService` now generates a RFC `Message-ID` header for comment emails when the caller did not provide one, returns/logs that RFC id, and updates `comment_threads.email_message_id` for successful sends where the associated comment is a top-level/root comment. No `In-Reply-To` header is added in this top-level path. Verified with `npx tsc -p packages/email/tsconfig.json --noEmit`.
- (2026-05-13) **F035 outbound reply In-Reply-To.** Added best-effort header enrichment in `BaseEmailService`: when sending an email for a reply comment (`comments.parent_comment_id` set), it looks up the latest successful `email_sending_logs.rfc_message_id` for that `comment_thread_id` and sets `In-Reply-To` unless the caller already supplied one. Top-level comments remain unchanged. Verified with `npx tsc -p packages/email/tsconfig.json --noEmit`.
- (2026-05-13) **F036 outbound References chain.** `BaseEmailService` now builds thread-specific `References` for reply comments from `comment_threads.email_references + latest outbound rfc_message_id`, emits that header with the email, and persists the deduped array back to `comment_threads.email_references` only after a successful send. Thread-specific headers intentionally override legacy ticket-level headers for comment replies. Verified with `npx tsc -p packages/email/tsconfig.json --noEmit`.
- (2026-05-13) **F037 outbound reply tokens.** No code change needed: `sendEventEmail` already generates a fresh `randomUUID()` token when `replyContext` is present, embeds the `ALGA-REPLY-TOKEN` marker in HTML/text, and persists `email_reply_tokens.comment_id` plus `recipient_email` for the outbound comment. Confirmed in `server/src/lib/notifications/sendEventEmail.ts`.
- (2026-05-13) **F038 outbound send log thread linkage.** `sendEventEmail` now passes the generated reply token through to `BaseEmailService` so `reply_token_hash`/suffix are populated even when callers did not provide `conversationToken`. `BaseEmailService.logEmailSendResult` looks up the outbound comment's `thread_id` and writes it to `email_sending_logs.comment_thread_id` alongside provider/RFC IDs and token fields. Verified with `npx tsc -p packages/email/tsconfig.json --noEmit` and `npx tsc -p server/tsconfig.json --noEmit`.
- (2026-05-13) **F039 shared thread grouping UI.** Added generic `CommentThreadList` and `buildCommentThreadGroups` in `packages/ui/src/components/CommentThreadList.tsx`. It accepts flat comments plus accessors, groups by `thread_id` (falling back to comment id for legacy rows), builds `childrenByParentId`, keeps replies chronological, derives `lastActivityAt`, and renders one group per thread in oldest/newest order. Exported from `packages/ui/src/components/index.ts`. Verified with `npx tsc -p packages/ui/tsconfig.json --noEmit`.
- (2026-05-13) **F040 recursive HybridThreadNode.** Added generic `HybridThreadNode` in `packages/ui/src/components/HybridThreadNode.tsx`. It renders a comment, a thread bar when children exist, and recursive child nodes from `childrenByParentId`; depth class emission caps at `depth-4` while recursion continues for unlimited data depth. Exported from `packages/ui/src/components/index.ts`. Verified with `npx tsc -p packages/ui/tsconfig.json --noEmit`.
- (2026-05-13) **F041 per-node collapse state.** `HybridThreadNode` now owns expanded/collapsed state for each node with children. The default thread bar shows `Collapse` while expanded and `Expand` plus `Open in drawer` while collapsed; collapsed nodes hide only their child subtree. Verified with `npx tsc -p packages/ui/tsconfig.json --noEmit`.
- (2026-05-13) **F042 open-panel callback.** No additional code needed after F041: `HybridThreadNode` exposes `onOpenPanel?: (commentId) => void`, passes it recursively, and the default collapsed thread bar calls it from `Open in drawer`.
- (2026-05-13) **F043 inline reply composer.** Added `InlineReplyComposer` in `packages/ui/src/components/InlineReplyComposer.tsx`. It uses BlockNote `TextEditor`, defaults internal visibility from the parent, exposes only the Mark-as-Internal switch (no resolution control), and submits `{ parentCommentId, content, isInternal }`. Exported from `packages/ui/src/components/index.ts`. Verified with `npx tsc -p packages/ui/tsconfig.json --noEmit`.
- (2026-05-13) **F044 comment thread drawer.** Added generic `CommentThreadDrawer` in `packages/ui/src/components/CommentThreadDrawer.tsx`. It wraps the existing Radix-backed `Drawer` at 480px, renders the root thread tree via `HybridThreadNode`, and shows an `InlineReplyComposer` at the bottom. Exported from `packages/ui/src/components/index.ts`. Verified with `npx tsc -p packages/ui/tsconfig.json --noEmit`.
- (2026-05-13) **F045 shared comment thread CSS.** Added `packages/ui/src/components/CommentThread.module.css` and imported it from `HybridThreadNode`. It defines global selectors for the left rail, thread-bar pill, dashed sub-thread bars, depth classes through `depth-4`, drawer spacing, inline composer spacing, and `.c-actions` hover/focus reveal. Verified with `npx tsc -p packages/ui/tsconfig.json --noEmit`.
- (2026-05-13) **F046 ticket Reply action.** `CommentItem` now accepts optional `onReply(comment)`, renders a `CornerUpLeft` reply button in the `.c-actions` hover/focus row ahead of edit/delete, and keeps existing call sites working when no reply handler is supplied. Verified with `npx tsc -p packages/tickets/tsconfig.json --noEmit`.
- (2026-05-13) **F047 ticket conversation thread renderer.** Replaced `TicketConversation`'s flat comment mapping with `CommentThreadList<IComment>` + `HybridThreadNode<IComment>`, preserving the existing top-level composer, tabs, sort toggle, edit/delete, upload session, metadata debug, and reactions through the existing `CommentItem` renderer. Verified with `npx tsc -p packages/tickets/tsconfig.json --noEmit`.
- (2026-05-13) **F048 ticket thread-level tabs.** `TicketConversation` now derives thread groups before tab filtering. All/Client/Internal select threads by root visibility, Resolution selects threads containing any resolution comment, and the rendered list includes all comments in matching threads so children stay attached. Client portal mode still excludes internal-rooted threads. Verified with `npx tsc -p packages/tickets/tsconfig.json --noEmit`.
- (2026-05-13) **No existing threading columns.** `comments` and `project_task_comments` are flat today; no `parent_id`, `reply_to_id`, or `thread_id`. Confirmed by reading `packages/types/src/interfaces/comment.interface.ts` (line 38).
- (2026-05-13) **Separate tables.** Tickets use `comments`; project tasks use `project_task_comments` (migration `20251118140000_create_project_task_comments.cjs`). No sharing — keep `comment_threads` polymorphic across both.
- (2026-05-13) **Today the ticket IS the email thread.** `tickets.email_metadata` (jsonb) stores `messageId`, `threadId`, `inReplyTo`, `references` for inbound matching. All inbound emails for a ticket collapse to flat comments. This is what the thread-as-entity refactor unblocks.
- (2026-05-13) **Outbound currently uses reply tokens, not RFC headers.** `email_reply_tokens` maps token → `(ticket_id | comment_id | project_id)`. The token marker `[ALGA-REPLY-TOKEN:...]` is embedded in the body. New work: ALSO set proper `In-Reply-To`/`References` so mail clients thread our messages, AND keep issuing tokens scoped to the new outbound comment.
- (2026-05-13) **`email_sending_logs` already has a `thread_id` column** (migration `20260331110000_add_email_threading_diagnostics_columns.cjs`). It looks like it refers to the provider's threadId. We will add a separate `comment_thread_id` column rather than overload — clearer and avoids semantic drift. If safe, rename the existing one to `email_provider_thread_id` in the same migration.
- (2026-05-13) **Drawer is a Radix Dialog.** Per `MEMORY.md`, the existing `packages/ui` `Drawer` uses Radix's `Dialog` internally with `modal={true}`. Nested dialogs are already handled by `InsideDialogContext` in `ModalityContext.tsx` — no extra wiring needed for the comment drawer.
- (2026-05-13) **Project task comments are internal-only today.** `author_type` is hardcoded 'internal' in `IProjectTaskComment`. So the task inline reply composer should NOT show a Mark-as-Internal toggle (different from ticket flow).
- (2026-05-13) **Reactions** already attach via `commentReactionActions`; nothing to change for replies — same per-comment reaction model applies.
- (2026-05-13) **Existing `ticketConversationOrderPreference`** stores newest-first preference per user. Reused as-is; applied to thread ordering after this change.

## Commands / Runbooks

- (2026-05-13) Run migrations locally:
  ```
  cd server && npm run db:migrate:latest
  ```
- (2026-05-13) Dev server (Docker, builds from current worktree per the alga-dev-env-manager skill):
  ```
  alga dev up
  alga dev rebuild server   # after schema or types change
  ```
- (2026-05-13) Run a single migration backwards (for iterating on backfill logic):
  ```
  cd server && npx knex migrate:down
  ```
- (2026-05-13) Playwright e2e — see the `playwright-testing` skill conventions; tests live under `server/src/__tests__/e2e/`.
- (2026-05-13) Email loop test (manual): use `shared/services/email/processInboundEmailInApp.ts` test fixture path; or trigger via the IMAP/MS Graph mock.

## Links / References

- **Design handoff bundle** (extracted): `/tmp/design_extract/comment-responses/`
  - `README.md` — handoff instructions
  - `chats/chat1.md` — user's design conversation; the source of intent
  - `project/Comment responses.html` — entry HTML
  - `project/conversation.jsx`, `comment.jsx`, `data.jsx`, `app.jsx` — prototype implementation we're recreating in real components
  - `project/styles.css` — pixel-level visual reference for thread bars, drawer, indent rail, depth cap
- **Implementation plan**: `/Users/natalliabukhtsik/.claude/plans/immutable-foraging-wirth.md`
- **Key existing files**:
  - `packages/tickets/src/components/ticket/TicketConversation.tsx`
  - `packages/tickets/src/components/ticket/CommentItem.tsx`
  - `packages/tickets/src/components/ticket/TicketDetails.module.css`
  - `packages/tickets/src/models/comment.ts`
  - `packages/tickets/src/actions/comment-actions/commentActions.ts`
  - `packages/projects/src/components/TaskComment.tsx`
  - `packages/projects/src/components/TaskCommentThread.tsx`
  - `packages/projects/src/components/TaskCommentForm.tsx`
  - `packages/projects/src/models/projectTaskComment.ts`
  - `packages/projects/src/actions/projectTaskCommentActions.ts`
  - `packages/types/src/interfaces/comment.interface.ts`
  - `packages/types/src/interfaces/projectTaskComment.interface.ts`
  - `shared/services/email/processInboundEmailInApp.ts`
  - `shared/workflow/actions/emailWorkflowActions.ts`
  - `server/migrations/202409071803_initial_schema.cjs` (comments table origin)
  - `server/migrations/20251118140000_create_project_task_comments.cjs` (project_task_comments origin)
  - `server/migrations/20260331110000_add_email_threading_diagnostics_columns.cjs` (email_sending_logs thread fields)

## Open Questions

- Exact rename/co-existence strategy for `email_sending_logs.thread_id` (provider) vs new `comment_thread_id`. Default plan: add new column, leave the old one alone; revisit if it causes confusion.
- Should `comment_threads.email_references` be capped in length (mail clients can emit 50+ References entries)? Default plan: no cap initially; revisit if storage growth is an issue.
- Whether project-task comment soft-delete needs the same "[deleted]" UX text or a different copy (tasks have less context). Default plan: same text, revisit during UI review.
