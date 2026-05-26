# PRD — Threaded Comment Responses

- Slug: `2026-05-13-threaded-comments`
- Date: `2026-05-13`
- Status: Draft

## Summary

Add replies to comments on tickets and project tasks. Replies render as an inline indented tree under their root (hybrid "Nested + collapsible drawer" model from the design handoff). Any reply can spawn its own sub-thread; visual indent caps at depth 4, data depth is unlimited. Every top-level comment becomes the head of a first-class `comment_threads` record that carries the email-thread identity (RFC `Message-ID` + `References` chain) so inbound and outbound email can flow correctly into and out of individual threads instead of being collapsed at the ticket level.

## Problem

1. Comments on tickets/tasks are a single chronological list. Two simultaneous conversations on a ticket (e.g. an internal investigation + a client-facing correspondence) interleave, which makes it hard to follow context.
2. The ticket is currently the email "thread": every inbound email matching a ticket becomes a flat comment, with no way to route subsequent emails to the specific sub-conversation they answer.
3. Outbound emails from comments use reply tokens but don't set RFC `In-Reply-To`/`References`, so mail clients can't thread our messages.

## Goals

- Reply to any comment on a ticket or project task; replies indent under the parent.
- Recursive sub-threads with a per-thread collapse and "Open in drawer" action.
- Internal/client visibility, resolution markers, edit/delete, reactions all continue to work.
- Inbound email lands in the **specific thread** it answers (via reply token, then `In-Reply-To`, then `References`, then provider thread id; falls back to a new top-level thread on the matched ticket).
- Outbound emails from a thread carry proper RFC threading headers, accumulate `References`, and reissue a thread-scoped reply token.
- Existing comments migrate cleanly (each becomes a single-comment thread; UI unchanged for them).

## Non-goals

- Notification UI changes (Slack / email templates).
- @mention picker upgrades.
- New resolution-state UI (e.g. "Mark thread resolved").
- The other reply modes from the prototype (Flat, Single-level only, Deep nesting only, Quote-reply, Side-panel-only) — those were design exploration; production ships the Hybrid model only. The Tweaks panel is prototype-only and is not part of production.
- Density toggle (always "comfortable").
- Project-task email integration (tasks don't accept inbound email today; out of scope here).
- Thread-level resolution semantics, "mark thread answered", and any thread state beyond what's needed for the UI.

## Users and Primary Flows

**Personas:**
- Internal MSP technician (full read/write across internal + client-facing comments).
- Client contact (read/write own client-facing comments).

**Primary flows:**
1. **Reply inline.** Tech hovers a comment → clicks **Reply** → inline composer opens beneath the comment → submits → reply renders indented under the parent. A small thread bar appears above the children: `"2 replies · Collapse"`.
2. **Collapse / Expand.** Tech clicks **Collapse** → children hide; bar now shows `"2 replies · last May 12, 9:24 AM"` with **Expand** and **Open in drawer**.
3. **Open in drawer.** Clicking **Open in drawer** opens a side panel with the root + all replies, focused composer at the bottom. Closing returns to inline view.
4. **Reply to a reply (sub-thread).** Replies can themselves be replied to; each gains its own thread bar with dashed border. Indent caps at depth 4 visually.
5. **Inbound email.** Client replies to our outbound email; the email matches the originating thread by `In-Reply-To`; a new comment lands as a child of the latest comment in that thread.
6. **Outbound email.** When a tech replies in a thread, the outgoing email sets `In-Reply-To: <latest outbound Message-ID for this thread>`, appends to `References`, and issues a fresh reply token tied to the new comment.

## UX / UI Notes

Source of truth: `/tmp/design_extract/comment-responses/` handoff bundle (saved from Claude Design). Key visual decisions copied verbatim:

- **Comments card chrome unchanged** from today's `TicketConversation` (24px card radius, indigo tabs, "Add Comment" purple button, BlockNote composer with Mark-as-Internal / Mark-as-Resolution switches).
- **Reply button** added to the per-comment hover action row (`Pencil`, `Trash`, now also `CornerUpLeft` "Reply").
- **Thread bar** is a pill at left-margin 24px above the children. Background `#F9FAFB`, indigo text `#4F46E5` for `Collapse` / `Open in drawer`. Sub-thread bars (depth ≥ 1) use a dashed border and white background.
- **Drawer** uses the existing Radix-based `Drawer` component from `packages/ui`; width 480px; slides from right; overlay `rgba(15, 23, 42, 0.25)`.
- **Internal visibility** indicators remain: amber `Lock` icon + amber 3px edge stripe. No tint mode.
- **Tab counts** are recomputed at the *thread* level (a thread shows up in "Internal" if its root is internal; in "Resolution" if any of its comments is a resolution).
- **Sort order** (oldest/newest first) toggles thread order by `last_activity_at`, not within-thread reply order — replies inside a thread are always chronological.
- **Depth cap**: CSS class `depth-4` stops increasing `margin-left`. Data is unlimited.

## Requirements

### Functional Requirements

1. New `comment_threads` table (polymorphic between ticket / project task, exactly one of `ticket_id`/`project_task_id` set).
2. `comments` and `project_task_comments` gain `thread_id` (NOT NULL after backfill) and `parent_comment_id` (nullable).
3. Backfill: every existing comment becomes its own single-comment thread with `parent_comment_id = NULL`.
4. Creating a comment without `parent_comment_id` creates a new `comment_threads` row; the new comment is its root.
5. Creating a comment with `parent_comment_id` inherits `thread_id` from the parent and increments `reply_count` + bumps `last_activity_at` on that thread.
6. Deleting a leaf comment hard-deletes and decrements thread `reply_count`. Deleting a root with children soft-deletes (`note` replaced with "[deleted]", a `deleted_at` set) so the tree stays well-formed.
7. Tab filtering operates on threads:
   - **All** — all threads.
   - **Client** — threads whose root is non-internal.
   - **Internal** — threads whose root is internal.
   - **Resolution** — threads containing any `is_resolution` comment.
8. Internal flag of a reply defaults to the parent's `is_internal` value in the inline composer.
9. "Mark as Resolution" is shown only at the top-level composer, not in inline reply composer.
10. **Inbound email resolution** (in order; first match wins):
    1. Reply token (`email_reply_tokens` → derive thread from token's `comment_id`)
    2. `In-Reply-To` header → look up in `email_sending_logs.rfc_message_id` → derive `comment_thread_id`
    3. `References[]` chain — walk from end to start
    4. `email_provider_thread_id` exact match on `comment_threads`
    5. Ticket-level fallback: existing `tickets.email_metadata` match → create a **new top-level thread** on that ticket (preserves today's behavior)
11. **Outbound email**:
    - New top-level reply: generate fresh RFC `Message-ID`, store in `comment_threads.email_message_id`; no `In-Reply-To`.
    - In-thread reply: `In-Reply-To: <latest outbound RFC Message-ID for this thread>`; append same to `References`.
    - Issue a reply token scoped to the new outbound comment.
    - Persist row in `email_sending_logs` with `comment_thread_id`, `rfc_message_id`, `reply_token_hash`.
12. Project tasks support the same UI threading, no email logic. `comment_threads.is_internal = false` for tasks (no internal/client distinction in task comments today).
13. Visual indent depth caps at 4; data has no cap.
14. Existing reactions, edit, delete, internal/resolution markers continue to work per comment.

### Non-functional Requirements

- Migrations safe on Citus (match patterns used by neighbors in `server/migrations/`).
- Backfill is idempotent and chunked so it runs cleanly on large tenants.
- Thread-level queries hit indexes: `(tenant, ticket_id, last_activity_at)`, `(tenant, project_task_id, last_activity_at)`, `(tenant, email_message_id)`.
- All comment writes remain inside `withTransaction()`; `reply_count` and `last_activity_at` are maintained in the same transaction.

## Data / API / Integrations

### Schema

```sql
CREATE TABLE comment_threads (
  tenant uuid NOT NULL,
  thread_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NULL,
  project_task_id uuid NULL,
  root_comment_id uuid NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  reply_count integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  email_message_id text NULL,
  email_references text[] NOT NULL DEFAULT '{}',
  email_provider_thread_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  PRIMARY KEY (tenant, thread_id),
  CHECK ((ticket_id IS NOT NULL)::int + (project_task_id IS NOT NULL)::int = 1),
  FOREIGN KEY (tenant, ticket_id) REFERENCES tickets (tenant, ticket_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant, project_task_id) REFERENCES project_tasks (tenant, task_id) ON DELETE CASCADE
);
CREATE INDEX comment_threads_ticket_idx ON comment_threads (tenant, ticket_id, last_activity_at DESC);
CREATE INDEX comment_threads_task_idx ON comment_threads (tenant, project_task_id, last_activity_at DESC);
CREATE INDEX comment_threads_email_msgid_idx ON comment_threads (tenant, email_message_id) WHERE email_message_id IS NOT NULL;
```

`comments` adds:
- `thread_id uuid NOT NULL` (after backfill)
- `parent_comment_id uuid NULL`
- FK `(tenant, thread_id) → comment_threads`
- FK `(tenant, parent_comment_id) → comments` (self-FK)
- `deleted_at timestamptz NULL` (for soft-delete of roots-with-children)

`project_task_comments` adds the same set.

`email_sending_logs` (already has `thread_id` — rename to `email_provider_thread_id` for clarity if safe; add new column `comment_thread_id uuid NULL` → `comment_threads.thread_id`).

### TypeScript Interfaces

- New: `ICommentThread` in `packages/types/src/interfaces/commentThread.interface.ts`.
- Extend `IComment` and `IProjectTaskComment` with `thread_id`, `parent_comment_id`, `deleted_at`.

### Server Actions (signatures)

`createComment(comment: IComment & { parent_comment_id?: string })` — resolves thread, increments counters, publishes event with `thread_id` + `parent_comment_id` in payload. Same for `createTaskComment`.

## Security / Permissions

- Reply visibility inherits root: a reply on a client-visible root cannot have `is_internal = true` at the data layer (model rejects). UI inherits parent's flag as default but allows toggling within rules. Conversely a reply on an internal root must be internal.
- Project-task `assertOwnCommentOrInternalUser` rule applies to replies (client can edit/delete own replies; internal users can do anything).
- Inbound-email-derived comments inherit the thread's `is_internal` flag (clients can only reply to client-visible threads).

## Observability

Out of scope per project conventions for this PR (no new metrics/logging beyond what the existing comment system already does).

## Rollout / Migration

1. Ship migrations behind a single deploy.
2. Backfill runs as part of the migration sequence. Chunked over `comments` and `project_task_comments`.
3. `NOT NULL` enforcement migration runs **after** backfill (separate migration file for safer rollout).
4. No feature flag — the UI change is rendered for everyone post-deploy. Existing comments render as single-comment threads (no thread bar, no visual change).

## Open Questions

- Exact name to use for the existing `email_sending_logs.thread_id` (which today refers to provider thread id). Decide on rename vs. add new column during implementation.
- Whether `comment_threads.email_references` should be capped in length (long mail clients can produce dozens of References entries).

## Acceptance Criteria (Definition of Done)

- All migrations apply cleanly on a fresh DB and on a copy of a production-shape dataset.
- Existing tickets and project tasks render identically to today (single-comment threads, no thread bar).
- Replying to a comment in a ticket produces an indented child + thread bar; collapse / expand / open-in-drawer all work.
- Sub-thread (reply to a reply) renders dashed-bordered sub-thread bar.
- Tab counts at the thread granularity match the rules in Functional Requirements §7.
- Inbound email lands in the right thread for each of the 5 resolution paths.
- Outbound email from a thread carries correct `In-Reply-To` and `References` headers.
- Mirror behaviors verified on project tasks (excluding email).
- Unit + integration + Playwright e2e tests in `tests.json` pass.
