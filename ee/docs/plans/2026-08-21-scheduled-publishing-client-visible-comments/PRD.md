# PRD — Scheduled publishing for client-visible ticket comments

- Slug: `scheduled-publishing-client-visible-comments`
- Date: `2026-08-21`
- Status: Draft
- Source: Alga PSA Releases v1.5.0 — feature request from Discord (Cha643). Card `5f43fedb-442f-47f6-bc13-7769e43f5be3`.

## Summary

Let an MSP agent compose a **client-visible** ticket comment now but choose a
**future time** for it to become visible to the client. Until that moment the
comment lives on the MSP ticket in a clear **Scheduled** state (with its publish
timestamp), is invisible to every client-facing read path, and triggers **no**
client notification. At the publish time the comment becomes a normal
client-visible comment and its normal client notification is dispatched **exactly
once**. Scheduling is tenant- and time-zone-safe, survives restarts and retries,
is enforced server-side, and preserves author and audit history. Agents can
edit, reschedule, or cancel a scheduled comment within existing comment
permissions. Internal-only comments are unchanged.

## Problem

Today a ticket comment's visibility is binary and immediate. `is_internal` on
the `comments` row (and its `comment_threads` root) decides whether the client
ever sees it, and the client email fires the moment an internal agent posts a
public comment (`TICKET_COMMENT_ADDED` → `ticketEmailSubscriber`). An agent who
wants a client-facing update to land at a specific later time (end of a
maintenance window, an agreed status-update cadence, business hours in the
client's region, after an internal review gate) has no product mechanism. Their
only options are to post immediately or to remember to come back later and post
by hand — the latter is unreliable and does not survive the agent going offline.

## User value

An MSP agent writes the client-facing update while the context is fresh and sets
it to publish at the right moment. The client sees a single, well-timed comment
and gets exactly one notification — never an early leak, never a duplicate. The
agent keeps full edit/reschedule/cancel control until it publishes, and the
whole ticket history records who authored it and when it was scheduled and
released.

## Goals

- An MSP internal user composing a **client-visible** comment can set a future
  publish time (in their time zone).
- Before publish time: the comment is fully invisible to all client-facing read
  paths (portal UI, client-portal server actions, and the REST/API service
  path) and no client notification of any channel is sent.
- Before publish time: the MSP ticket shows the comment in a clear **Scheduled**
  state with the publish timestamp and time zone, preserving the author.
- At publish time: the comment becomes a normal client-visible comment and its
  normal client notification (`TICKET_COMMENT_ADDED` → email/internal/webhook/
  push subscribers) is dispatched **exactly once**, including after restarts,
  retries, or a boot-time catch-up of an overdue schedule.
- Publishing is durable: a scheduled publish survives a process restart /
  redeploy and still fires (at its time, or immediately if it came due while the
  process was down).
- An agent can **edit**, **reschedule**, or **cancel** a scheduled comment,
  gated by the same permissions that already govern editing/deleting a comment.
- Author and audit history are preserved across schedule → publish, and across
  reschedule/cancel.

## Non-goals

- Scheduling **internal-only** comments. Scheduling applies only to
  client-visible comments; internal notes are unchanged.
- Letting **client-portal** users schedule comments. Client authors always post
  immediately (portal already hard-forces `is_internal = false` and no
  scheduling input is accepted).
- Recurring / repeating publication. A schedule is a single one-time future
  publish.
- Scheduling other ticket mutations (status changes, assignments) — comments
  only.
- Changing the content or channels of the existing client notification. We reuse
  the existing `ticket-comment-added` path unchanged; we only change **when** it
  fires and guarantee once-only delivery.
- A new standalone "outbox/queue" management screen. Scheduled comments are
  managed inline on the ticket.

## Users and Primary Flows

**Persona: MSP agent (internal user)** with permission to comment on a ticket.

1. **Schedule a client update.** Agent opens a ticket, composes a client-visible
   comment, toggles **Schedule**, picks a future date/time (shown in their time
   zone), and sends. The comment appears on the MSP ticket in the Client/All tab
   with a **Scheduled** badge and "Publishes <timestamp> <tz>". No client email
   goes out; the client portal shows nothing.
2. **Publish (automatic).** At the chosen time a durable job flips the comment to
   published, the client portal now returns it, and exactly one client
   notification is sent — identical to an immediately-posted public comment.
3. **Edit before publish.** Author (or an internal user per existing rules)
   edits the pending comment's text; the schedule is unchanged and still no early
   client exposure.
4. **Reschedule.** Author/internal user changes the publish time; the old timer
   is cancelled and a new one is set.
5. **Cancel.** Author/internal user cancels the scheduled comment before it
   publishes; it is withdrawn (never shown to the client, never notified) while
   its audit trail is retained.
6. **Restart resilience.** If the server restarts, scheduled publishes still
   fire; anything that came due during downtime publishes on the next boot's
   reconciliation.

## UX / UI Notes

- **Composer** (`packages/tickets/src/components/ticket/TicketConversation.tsx`):
  when the comment is client-visible (i.e. **not** "Mark as Internal") and the
  view is the MSP view (`!hideInternalTab`), show a **Schedule** affordance — a
  toggle that reveals a date/time picker defaulted to the user's time zone
  (`getUserTimeZone()`), plus the resolved absolute time preview. "Send" becomes
  "Schedule" when a future time is set. Scheduling controls never render in the
  client portal view or when "Mark as Internal" is on.
- **Comment item** (`packages/tickets/src/components/ticket/CommentItem.tsx`): a
  scheduled comment renders a distinct **Scheduled** badge (visually separate
  from the Internal badge) reading e.g. "Scheduled · Publishes Aug 22, 3:00 PM
  EDT", the author as normal, and — subject to permissions — **Edit**,
  **Reschedule**, and **Cancel** actions. After publish it renders as an ordinary
  client comment.
- **Tab placement**: a scheduled client-visible comment appears in the MSP
  **Client** and **All** tabs (it is a client-intended comment), never in the
  **Internal** tab. It is excluded from client-portal tabs entirely (server-side).
- **Time-zone clarity**: the picker operates in the user's time zone; the stored
  absolute instant and its IANA zone are shown so there is no ambiguity about
  when it will publish.
- **Client portal** (`packages/client-portal/.../TicketDetails.tsx`): no visible
  change. Scheduled comments simply do not exist for the client until published.

## Requirements

### Functional Requirements

1. A client-visible comment MAY carry a future publish time; a comment without
   one behaves exactly as today (immediate).
2. Scheduling is permitted only when: author is an **internal** MSP user, the
   comment is **client-visible** (`is_internal = false`), the comment is not
   system-generated, and the requested time is in the **future**. Otherwise the
   create/reschedule is rejected server-side.
3. While a comment is in the **scheduled** state it MUST be excluded from all
   three client-facing read paths:
   - portal action query (`client-tickets.ts` conversations query),
   - REST API service (`TicketService.getTicketComments` client-visibility branch),
   - and any other path that serves comments to a client context.
   Exclusion is by a server-side predicate, not by UI hiding.
4. While scheduled, **no** client notification of any channel (email, in-app,
   webhook, push, Teams) is dispatched for the comment. The ticket
   `response_state` is not advanced to a client-facing state yet.
5. At publish time the comment transitions to **published** and the normal
   `TICKET_COMMENT_ADDED` event is published so the existing subscribers deliver
   the client notification, update `response_state`, and log activity — exactly
   as for an immediately-posted public comment.
6. Publication is **exactly-once**: retries, duplicate jobs, and boot-time
   reconciliation of an overdue schedule MUST NOT produce a second notification.
7. Publication is **durable**: it survives process restart/redeploy; a schedule
   that came due during downtime publishes on the next reconciliation.
8. **Edit** of a scheduled comment's content is allowed within existing
   comment-edit permissions and does not change the schedule or cause early
   exposure.
9. **Reschedule** updates the publish time (must remain in the future), cancels
   the prior timer, and arms a new one, within existing permissions.
10. **Cancel** withdraws a scheduled comment before publish: it is never shown to
    the client and never notified; audit history is retained. Gated by existing
    comment-delete permissions.
11. **Author and audit** are preserved through schedule → publish and through
    reschedule/cancel. Scheduling, rescheduling, cancelling, and publishing are
    each recorded in ticket activity.
12. Internal-only comments and the client-portal comment path are behaviorally
    unchanged.

### Non-functional Requirements

- **Tenant-safe**: every scheduled-publish job carries `tenantId`; all reads/
  writes are tenant-scoped (`runWithTenant`/`tenantDb`); `comments` remains
  tenant-partitioned/Citus-distributed.
- **Time-zone-safe**: the publish instant is stored as UTC `timestamptz`; the
  originating IANA time zone is stored for display. No wall-clock ambiguity.
- **Idempotent by construction**: the publish transition is an atomic
  conditional DB update; only the winning transition emits the event.
- **Restart-safe**: rely on the durable job store plus a boot-time reconciler,
  mirroring the workflow-schedule precedent.

## Data / API / Integrations

### Data model (migration on `comments`)

Add to the `comments` table (tenant-partitioned; add a matching backfill and a
partial index for the reconciler):

- `publish_state text NOT NULL DEFAULT 'published'`
  `CHECK (publish_state IN ('published','scheduled','canceled'))` — existing rows
  backfill to `'published'`.
- `scheduled_publish_at timestamptz NULL` — UTC instant to publish.
- `scheduled_publish_tz varchar(64) NULL` — IANA zone captured at schedule time.
- `published_at timestamptz NULL` — actual publish instant (set at transition).
- `schedule_job_id uuid NULL` — the `jobs.job_id` of the arming job, for
  cancel/reschedule.
- Partial index `(tenant, scheduled_publish_at) WHERE publish_state = 'scheduled'`
  for the boot reconciler / overdue sweep.

Derived state: `scheduled` = `publish_state='scheduled'`; visible-to-client
requires `publish_state='published'` (plus existing `is_internal=false` and
thread-not-internal rules). Cancel sets `publish_state='canceled'` and
soft-withdraws (existing `deleted_at`) while retaining the row for audit.

Update `IComment` (`packages/types/src/interfaces/comment.interface.ts`) with the
new fields.

### Visibility enforcement (the security core)

Add a `publish_state = 'published'` predicate to the two client-facing read
paths already filtering `is_internal`:

- `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts`
  conversations query (~L398-415).
- `server/src/lib/api/services/TicketService.ts` `getTicketComments`
  client-visibility branch (~L1914-1926), applied **before pagination**.

MSP path (`Comment.getAllbyTicketId`) is unchanged (agents see scheduled +
published; canceled is soft-withdrawn).

### Write path & actions

- Extend `createComment` (`packages/tickets/.../commentActions.ts`) and
  `TicketService.addComment` to accept optional `scheduledPublishAt` +
  `scheduledPublishTz`; validate per FR-2; on a scheduled create: persist with
  `publish_state='scheduled'`, **suppress** the client-facing
  `TICKET_COMMENT_ADDED` emission, do not advance `response_state`, write a
  "comment scheduled" activity, and arm the job.
- New actions `rescheduleScheduledComment(commentId, newAt, tz)` and
  `cancelScheduledComment(commentId)` with permission checks mirroring
  `updateComment`/`deleteComment`.
- Client-portal `addClientTicketComment` ignores/rejects any scheduling input
  (belt-and-suspenders) and always posts immediately.

### Scheduler & publish handler

- Use the unified job runner: `IJobRunner.scheduleJobAt('publish-scheduled-comment',
  { tenantId, ticketId, commentId }, runAt, { singletonKey: 'publish-comment:<commentId>', metadata })`
  (`PgBossJobRunner`/`TemporalJobRunner` via the factory).
- Register a `publish-scheduled-comment` handler in
  `server/src/lib/jobs/registerAllHandlers.ts`. The handler performs an atomic
  conditional transition:
  `UPDATE comments SET publish_state='published', published_at=now() WHERE (tenant,comment_id)=… AND publish_state='scheduled' RETURNING …`.
  If 0 rows (already published/canceled) → **no-op, no event** (exactly-once).
  On the winning transition it publishes `TICKET_COMMENT_ADDED` (reusing the
  existing payload builder) and advances `response_state`.
- **Cancel/reschedule** call `runner.cancelJob(externalId)`; even if job
  cancellation is missed, the handler's `WHERE publish_state='scheduled'` guard
  prevents publishing a canceled comment.
- **Boot reconciliation** `reconcileScheduledCommentPublications()` registered in
  `server/src/lib/initializeApp.ts` (mirroring
  `reconcileWorkflowScheduleRegistration`): for each `publish_state='scheduled'`
  comment — if overdue (`scheduled_publish_at <= now`) publish immediately via the
  same handler; else ensure a job is armed (the `singletonKey` dedupes).

### Existing precedents reused

- Durable future-time scheduling + idempotent fire-key + boot reconcile:
  `ee/packages/workflows/src/lib/workflowScheduleLifecycle.ts`,
  `packages/jobs/src/lib/handlers/workflowScheduledRunHandlers.ts`,
  `ee/server/migrations/20260307200000_create_workflow_schedule_tables.cjs`.
- Deferred ticket-state change: `autoCloseTicketsHandler.ts`.
- Notification path: `TICKET_COMMENT_ADDED` →
  `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`
  (`handleTicketCommentAdded`), gated by `sendNotificationIfEnabled`.

## Security / Permissions

- Only internal MSP users can schedule/reschedule/cancel; enforced server-side in
  the actions (not just UI).
- Scheduling only for client-visible, non-system comments.
- Visibility is enforced by server-side query predicates on **every**
  client-facing read path; UI hiding is not relied upon.
- Client-portal write path continues to hard-force `is_internal=false` and now
  also refuses scheduling input.
- Reschedule/cancel reuse the existing author-or-internal gates from
  `updateComment`/`deleteComment`.

## Observability

Out of scope beyond the audit trail required by the feature (ticket-activity rows
for schedule/reschedule/cancel/publish and the existing job status rows in
`jobs`/`job_details`). No new dashboards/metrics unless requested.

## Rollout / Migration

- Additive migration only (new nullable columns + one CHECK-constrained column
  defaulting to `'published'` + partial index). Existing comments backfill to
  `'published'`; existing behavior is byte-for-byte unchanged when no schedule is
  set.
- No feature flag assumed (add on request). CE uses pg-boss runner; EE uses
  Temporal runner — the feature goes through the shared `IJobRunner` so both work.
- Backward compatible: older read paths that don't yet include the
  `publish_state` predicate would leak scheduled comments, so the read-path
  predicates ship in the same change as the write path.

## Open Questions

1. **Minimum lead time / max horizon** for a schedule (e.g. must be ≥1 min in the
   future; cap at N months)? Default proposal: must be strictly in the future,
   no upper cap.
2. **Editing a published comment** — unchanged from today (normal edit rules; no
   re-notification). Confirm no re-notify on post-publish edits is desired.
3. **Resolution comments**: allow scheduling a comment also flagged
   `is_resolution`? Default proposal: allow (visibility rules are orthogonal), but
   confirm.
4. **Assigned-agent / internal notifications** at schedule time: default proposal
   is to fire *all* notifications (client + internal) at **publish** time only,
   and record a lightweight internal activity/audit at schedule time. Confirm MSP
   colleagues don't need an at-schedule internal notification.
5. **Cancel semantics**: soft-withdraw via `publish_state='canceled'` +
   `deleted_at` (retain for audit) vs. hard delete. Default proposal: soft.

## Acceptance Criteria (Definition of Done)

- **Pre-release invisibility**: a scheduled client-visible comment is returned by
  none of the client-facing read paths and triggers no client notification of any
  channel while `publish_state='scheduled'`. (Integration test against migrated
  schema on both the portal action and the REST service path.)
- **Release-time visibility**: at/after `scheduled_publish_at` the publish handler
  transitions the comment to `published`, the client-facing read paths now return
  it, and `response_state` advances as for a normal public comment.
- **Idempotent notification delivery**: running the publish handler twice (retry)
  and/or the boot reconciler racing the armed job produces exactly one
  `TICKET_COMMENT_ADDED` emission / one client email.
- **Restart survival**: a schedule armed before a restart still publishes; an
  overdue schedule publishes on boot reconciliation.
- **MSP scheduled-state UI**: the MSP ticket shows the scheduled comment with a
  Scheduled badge + publish timestamp/zone and author, offers edit/reschedule/
  cancel per permissions, and the client portal shows nothing until publish.
- **Edit/reschedule/cancel**: each works within existing comment permissions;
  cancel withdraws without notifying; reschedule re-arms the timer; author/audit
  preserved throughout.
- **Internal comments unchanged**: internal-only and client-portal comment flows
  behave exactly as before.
