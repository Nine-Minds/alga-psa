# Scratchpad — Scheduled publishing for client-visible ticket comments

- (2026-08-22) Publication persists stable IDs and independent dispatch markers for the comment-added and response-state events. The state transition, response-state mutation, and publication audit commit atomically; retries and boot reconciliation re-drive undispatched events.
- (2026-08-22) `zonedWallTimeToUtc` uses Temporal with `disambiguation: 'reject'`, so datetime-local values use the displayed IANA zone and DST gaps/repeated times are rejected.
- (2026-08-22) Behavioral coverage is in `ticketClientPortalAbac.integration.test.ts` (real migrated DB visibility and crash/retry) and `CommentItem.metadataDebug.test.tsx` (scheduled badge/actions/dialog).

- Plan slug: `scheduled-publishing-client-visible-comments`
- Created: `2026-08-21`
- Source: Alga PSA Releases v1.5.0 — feature request from Discord (Cha643). Card `5f43fedb-442f-47f6-bc13-7769e43f5be3`.

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Requirement (verbatim intent from card)

- MSP user composing a **client-visible** comment can choose a future publish time.
- Before publish time: MSP ticket shows the comment in a clear **Scheduled** state with the publish timestamp; client-portal APIs and UI do **not** expose it; **no** client notification is sent.
- At publish time: comment becomes normally visible in the client portal and its normal client notification is dispatched **exactly once**.
- Scheduling must be tenant- and time-zone-safe, survive restarts and retries, enforce visibility **server-side**, preserve author + audit history.
- Support edit / reschedule / cancel where consistent with existing comment permissions.
- Internal-only comments unchanged.
- Acceptance: behavioral coverage for pre-release invisibility, release-time visibility, idempotent notification delivery, and MSP scheduled-state UI.

## Decisions

- (2026-08-21) Plan folder created under `ee/docs/plans/2026-08-21-scheduled-publishing-client-visible-comments/`.

## Discoveries / Constraints

- (2026-08-21) Research agents dispatched: (A) comments data model + visibility enforcement + UI; (B) notifications dispatch + job scheduler / deferred-job infra + timezone handling.

## Discoveries — Comments subsystem (research A)

- Monorepo. Comment logic in `packages/tickets` (shared MSP+portal actions/components), `packages/client-portal` (portal-only), `packages/types` (interfaces), `server/` (migrations + REST API + Next pages).
- **`comments` table**: `(tenant, comment_id)` PK; cols incl. `ticket_id`, `thread_id`, `parent_comment_id`, `user_id`, `contact_id`, `author_type` (enum: internal|client|contact|system|unknown), `note`, `markdown_content`, `is_internal`, `is_resolution`, `is_system_generated`, `metadata` (JSON, carries `responseSource`), `deleted_at`, `created_at`, `updated_at`. No timed-visibility column exists today.
- **`comment_threads` table** (`20260513100000...`): carries thread-root visibility via **`is_internal`** (NOT NULL default false). Replies MUST match thread root visibility (enforced in model `insert`). Backfilled + NOT-NULL enforced.
- Interfaces: `packages/types/src/interfaces/comment.interface.ts` (`IComment`, `CommentAuthorType`, `COMMENT_RESPONSE_SOURCES`), `commentThread.interface.ts`.
- Model: `packages/tickets/src/models/comment.ts` — `getAllbyTicketId` has NO visibility filter (MSP sees all; tab-split is client-side).
- **Create/edit/delete actions (MSP)**: `packages/tickets/src/actions/comment-actions/commentActions.ts` — `createComment` (~L203), `updateComment` (~L477, blocks system-generated, only author/internal edit, clients can't flip is_internal), `deleteComment` (~L688). Publishes `TICKET_COMMENT_ADDED` + workflow events; writes `ticket_activity`.
- **Client-portal create action**: `packages/client-portal/src/actions/client-portal-actions/client-tickets.ts` — `addClientTicketComment` (~L534) hard-forces `isInternal=false` server-side.
- **Server-side visibility enforcement — THREE read paths, same rule** (hide if comment.is_internal OR thread.is_internal):
  1. Portal action `client-tickets.ts` conversations query (~L398-415): joins `comment_threads ct`, filters `comments.is_internal=false` AND `(ct.is_internal null OR false)`. Tests: `client-tickets.visibility.test.ts`.
  2. REST API `server/src/lib/api/services/TicketService.ts` `getTicketComments` (~L1902-1926): same join filter applied BEFORE pagination when `resolveClientTicketVisibility(context)` truthy.
  3. MSP path `Comment.getAllbyTicketId` — NO filter (MSP sees all).
  => **These are the exact insertion points for scheduled visibility gating.**
- **UI**: shared `packages/tickets/src/components/ticket/TicketConversation.tsx` (composer has "Mark as Internal" Switch ~L698, only when `!hideInternalTab`). `CommentItem.tsx` renders per-comment (badges, canEdit gating ~L207). Tab-split in `ticketConversationThreadTabs.ts` (`buildTicketThreadTabState`). MSP parent: `packages/tickets/src/components/ticket/TicketDetails.tsx` (`hideInternalTab={false}`). Portal: `packages/client-portal/src/components/tickets/TicketDetails.tsx` (`hideInternalTab={true}`).
- REST endpoints: `server/src/app/api/v1/tickets/[id]/comments/route.ts` (+ `[commentId]`), controller `ApiTicketController.ts` (`addComment` ~L1281), service `TicketService.ts`.
- Mobile EE mirrors distinction: `ee/mobile/src/features/ticketDetail/components/CommentsSection.tsx`, `ee/mobile/src/api/tickets.ts`.

## Discoveries — Notifications + Scheduler (research B)

- Two runtimes: Next.js `server/` and `services/workflow-worker/`. Jobs abstracted behind `IJobRunner` — pg-boss (CE) + Temporal (EE), selected by `JobRunnerFactory`/`getRunnerType()`.
- **Notification path**: `TicketService.addComment` (`server/src/lib/api/services/TicketService.ts` ~L2034) publishes `TICKET_COMMENT_ADDED` after commit (~L2203) with suppression flags from `resolveTicketNotificationSuppression`. Subscriber `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` → `handleTicketCommentAdded` (~L2443): emails the client contact only when `isPublicComment (!isInternal) && isFromAgent`. Final send gated by `sendNotificationIfEnabled` → `resolveNotificationGate`. Template `ticket-comment-added`. Other channels: internalNotificationSubscriber, pushNotificationDispatcher, webhookSubscriber, Teams.
- **Durable future-time scheduling**: `IJobRunner.scheduleJobAt(jobName, data, runAt, {singletonKey, metadata})` — `server/src/lib/jobs/runners/PgBossJobRunner.ts` (~L266). pg-boss `boss.send(name, data, {startAfter: runAt})` — delayed jobs persisted in `pgboss.*` tables, survive restart natively. App monitoring tables `jobs`/`job_details` (`20250122213222_create_generic_job_tables.cjs`, + `runner_type`/`external_id` in `20251130000000_add_job_runner_metadata.cjs`). `BaseJobData` REQUIRES `tenantId`.
- Handler registration: `server/src/lib/jobs/registerAllHandlers.ts` → `JobHandlerRegistry`; startup `server/src/lib/jobs/initializeJobRunner.ts` (called from `initializeApp.ts` ~L453). pg-boss retryLimit:3 + retryBackoff.
- **STRONGEST precedent** = workflow schedules: table `tenant_workflow_schedule` (`ee/server/migrations/20260307200000...`) with `run_at timestamptz`, `timezone varchar(64)`, `next_fire_at`, `last_fire_key` (idempotency). Lifecycle `ee/packages/workflows/src/lib/workflowScheduleLifecycle.ts` — `scheduleDesiredWorkflow` uses `scheduleJobAt(..., {singletonKey})`; **boot reconcile** `reconcileWorkflowScheduleRegistration` re-registers on every boot. Handler `packages/jobs/src/lib/handlers/workflowScheduledRunHandlers.ts` checks `last_fire_key` before firing (idempotent).
- Other deferred precedents: `autoCloseTicketsHandler.ts` (deferred ticket-state change — closest in spirit), `generateInvoiceHandler.ts` (`scheduleScheduledJob('generate-invoice', runAt, ...)`).
- **Timezone**: store UTC `timestamptz`; carry IANA `timezone` string for display/cron. Utils `server/src/lib/utils/dateTimeUtils.ts` (`utcToLocal`, `getUserTimeZone`). Convention: store UTC, convert for display.

## Decisions (design)

- (2026-08-21) **Scheduling state lives on the `comments` row**, not a companion table — the client-visibility gate must be a cheap column in the hot read path (no extra join). Columns: `publish_state` (published|scheduled|canceled, default published), `scheduled_publish_at timestamptz`, `scheduled_publish_tz varchar(64)`, `published_at timestamptz`, `schedule_job_id uuid`. Partial index on scheduled rows for the reconciler.
- (2026-08-21) **Exactly-once via atomic DB transition**, not a separate fire-key table: publish handler does `UPDATE ... SET publish_state='published' WHERE publish_state='scheduled' RETURNING`; only the winning transition emits `TICKET_COMMENT_ADDED`. Beats a fire-key check because retries/reconciler/duplicate-jobs all funnel through one conditional row transition. Cancel/reschedule guarded by the same `WHERE publish_state='scheduled'`.
- (2026-08-21) **Notification deferral**: scheduled create SUPPRESSES the client-facing `TICKET_COMMENT_ADDED`; the publish handler re-emits it at publish time so all existing subscribers (email/internal/webhook/push/Teams) fire once. response_state deferred to publish.
- (2026-08-21) **Durability = pg-boss delayed job (native) + boot reconciler** mirroring `reconcileWorkflowScheduleRegistration`: overdue → publish now; future-missing-job → re-arm (singletonKey dedupes). Works for both pg-boss and Temporal runners via `IJobRunner`.
- (2026-08-21) **Visibility gate** = add `publish_state='published'` predicate to the two client-facing read paths (client-tickets.ts query; TicketService.getTicketComments, before pagination). MSP path unchanged. Belt-and-suspenders: portal write path refuses scheduling input.
- (2026-08-21) **Permissions**: schedule/reschedule/cancel reuse existing author-or-internal gates from updateComment/deleteComment; scheduling only for internal-authored, client-visible, non-system comments, future time only.
- (2026-08-21) Order asked for best-judgement design (no interrogation). PRD "Open Questions" holds the 5 confirm-later items (min lead time, post-publish edit re-notify, scheduling a resolution comment, at-schedule internal notification, cancel soft vs hard) with default proposals; none block the design.

## Commands / Runbooks

- Worktree: `/home/robert/alga-copies/feature-scheduled-publishing-for-client-visible-ticket-c`, branch `feature/scheduled-publishing-for-client-visible-ticket-c`, devPort 3806, compose project `alga-psa-local-test`.

## Links / References

- Card: `5f43fedb-442f-47f6-bc13-7769e43f5be3` (Alga Task Office).

## Open Questions

- Which scheduler subsystem to use (pg-boss? Temporal? workflow timers? a jobs table)? — pending research (B).
- Comment table schema + where is_internal is filtered for client portal — pending research (A).
