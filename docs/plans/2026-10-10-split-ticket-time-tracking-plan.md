# Plan: Split ticket time tracking into a server-side stopwatch and a passive work trail

PSA ticket alga0002288 · GitHub Nine-Minds/alga-psa#3204 · branch `feature/split-ticket-time-tracking-server-side-stopwatch` · base `main` @ `b0d0b4dacf`

## 1. Problem

The ticket page runs one browser-local mechanism (IndexedDB intervals plus a React tick counter) that does two jobs at once: it is a stopwatch, and it is a record of which tickets were opened. Auto-start on ticket open joins the two. Reading a ticket therefore looks like billable time (#3204), and the page shows three versions of time that disagree: the clock, the interval list, and the time entries.

The mobile app already has a different model: a server-side "session" that is a `time_entries` row with `end_time` NULL. So web and mobile have two stopwatch models, and neither is correct.

This plan replaces both with:

1. **A stopwatch.** Started only by the user, stored on the server, and shared by web and mobile. It is the only thing that runs a clock. Stopping it produces exactly one time entry, through the same write path as every other entry.
2. **A work trail.** A record, derived on the server, of the tickets a user acted on each day. It is shown on the timesheet as suggested entries. It never runs a clock and never creates time unless the user acts.

## 2. What the code has today

### 2.1 Web: IndexedDB intervals and a tick counter

| Piece | Where | Notes |
|---|---|---|
| Interval store | `packages/ui/src/services/IntervalTrackingService.ts` (685 lines) | IndexedDB `TicketTimeTrackingDB` v3, intervals and per-tab locks with a heartbeat. `IntervalTrackingStateMachine` at L597. |
| Hook | `packages/ui/src/hooks/useTicketTimeTracking.ts` | Init runs `cleanupOrphanOpenIntervals` and `trimIntervalsForTicket(…, 20)`. The `autoStart` option is always passed `false`. |
| Count hook | `packages/ui/src/hooks/useIntervalTracking.ts` | Only consumer is `TicketingDashboard.tsx:66,971`, which destructures `intervalCount` and never uses it. |
| Interval UI | `packages/scheduling/src/components/time-management/interval-tracking/` | `IntervalManagement.tsx` (ticket page), `IntervalSection.tsx` (timesheet, `TimeSheet.tsx:42,935`), `IntervalItem.tsx`, `utils.ts`. `IntervalManagementDrawer.tsx` has no importers. |
| Types | `packages/types/src/lib/interval-tracking.ts` | Re-exported from `types/index.ts:23`. |
| Dead copies | `server/src/services/IntervalTrackingService.ts`, `server/src/hooks/useTicketTimeTracking.ts`, `server/src/hooks/useIntervalTracking.ts`, `server/src/types/interval-tracking.ts` | Imported only by each other. |

`TicketDetails.tsx` (4858 lines) holds the clock:
- `elapsedTime` and `isRunning` state (L1330), with a 1 s `setInterval` tick (L1512–1528).
- The auto-start effect (L1628–1649), a board-policy effect that stops tracking when the flag is off (L1652–1670), and a 5 s lock poll (L1673).
- `doStart` resets the clock on every start, including resume (L1740).
- Unmount stops tracking (L1781–1790). `handleBackToTickets` (L1711) is defined but never referenced.
- `handleAddTimeEntry` (L2603) passes `elapsedTime` into `buildTicketTimeEntryContext` (`packages/tickets/src/lib/timeEntryContext.ts:14`). `resolveEntryDefaults` (`packages/scheduling/src/lib/timeEntryPeriodSelection.ts:154–200`) then derives start = now − elapsed.

The clock props (`elapsedTime`, `isRunning`, `isTimerLocked`, `onStart`/`onPause`/`onStop`, `renderIntervalManagement`) flow to two places:
- `TicketBentoLayout.tsx`: `timerTile` (L630–729).
- `TicketProperties.tsx`: the Time Entry card (L597–698).

`renderIntervalManagement` is injected from `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx:91–111` through `TicketDetailsContainer.tsx:95,126,362`.

### 2.2 Mobile and the API: open time-entry rows

`server/src/lib/api/services/TimeEntryService.ts`:
- `startTimeTracking` (L568) inserts a `time_entries` row with `end_time: null`, `billable_duration: 0`, and no `time_sheet_id` or `contract_line_id`. The rule of one active session per user is only an application check, so two concurrent starts can both pass it.
- `stopTimeTracking` (L632) sets `end_time` and `billable_duration`. It never resolves a time sheet, contract line, bucket draw, hour block or ticket resource.
- `getActiveSession` (L706) returns the open row.

Routes:
- `server/src/app/api/v1/time-entries/{start-tracking,stop-tracking/[sessionId],active-session}`.
- Controller: `ApiTimeEntryController.ts` (L338, L416, L499). `getActiveSession` has no permission check.

Mobile:
- API wrappers in `ee/mobile/src/api/timeTracking.ts`.
- State in `ee/mobile/src/features/timer/TimerContext.tsx`: statuses `loading|idle|running`, a server clock offset, a "switch timer" flow, and refresh on app resume.
- UI: `HeaderTimerChip`, `TicketTimerChip`, `StopTimerModal`.

Who sees open rows (from a sweep of every `time_entries` reader):

| Reader | Effect of an open row |
|---|---|
| Ticket time list `packages/scheduling/src/actions/timeEntryTicketActions.ts:82–104` | Leaks; its row type also declares `end_time` non-null |
| Ticket billing rollup `packages/tickets/src/actions/ticketBentoActions.ts:310` | Inflates `entryCount` |
| `packages/tickets/src/lib/validateTicketClosure.ts:111` | A running session satisfies `require_time_entry` |
| `packages/user-activities/src/actions/activityStatusActions.ts:100` | Can set `approval_status` on an open row |
| `TimeEntryService` list/search/export/stats, search indexer `packages/search/src/indexers/time_entry.ts:91` | Leak |
| Report counts (`helpdeskReportActions`, `TeamService`, `profitabilityReportActions`) | Counts include open rows; sums are safe because they skip NULLs |
| Billing engine, approvals, timesheets (all filter by `time_sheet_id` or APPROVED) | Safe while the row is open |

Two more problems:
- A **stopped** API entry has no `time_sheet_id`, so it never appears on a timesheet and can never be submitted or approved. Because it has `billable_duration > 0` and no `contract_line_id`, it shows up as an unresolved charge (`unresolvedChargeActions.ts:136`).
- `time_entries.end_time` is nullable only by accident. The initial schema declares it NOT NULL; `20241019194900_update_time_period_fields_to_timestamp.cjs:13` dropped the constraint as a side effect of `.alter()`.

### 2.3 The correct write path already exists, but only as a server action

`saveTimeEntry` (`packages/scheduling/src/actions/timeEntryCrudActions.ts:302`) does all of the following inside one transaction:
- RBAC and `assertCanActOnBehalf`.
- A sheet-owner and period check, with the sheet rows locked (`FOR UPDATE`, DRAFT/CHANGES_REQUESTED only).
- Contract-line resolution (`resolveContractLineSelection`).
- Bucket draw (`adjustTimeSpanDraw`) and hour-block burn (`allocateTimeEntry`).
- Change-request handling, the project-hours recalculation, and adding the user to ticket/task resources.

The sheet itself is resolved on the client (`packages/scheduling/src/lib/timeEntrySaveAdapter.ts:53` `createCatalogSheetResolver` → `fetchOrCreateTimeSheet`). `TimeEntryService.create` (API) is a second, thinner write path that skips the bucket, hour-block and resource steps.

### 2.4 Activity that can feed a trail

`ticket_audit_logs` (`server/migrations/20260525231145_create_ticket_audit_logs.cjs`, writer `shared/lib/ticketActivity/writeTicketActivity.ts`) is the source:
- Columns: `actor_type`, `actor_user_id`, `event_type`, `occurred_at`.
- It is written in the same transaction as ticket updates (`optimizedTicketActions.ts:3240`), REST updates (`TicketService.ts:2199`), comments and internal notes (`commentActions.ts:500`), assignment changes, documents, checklists and external links.
- It is distributed by `tenant`.
- Its only index is `(tenant, ticket_id, occurred_at, audit_id)`, so there is nothing to query by actor.

Gaps:
- Adding an additional agent (`ticket_resources`, `shared/services/tickets/ticketResourceCore.ts:115`) writes no audit row.
- No ticket views are stored anywhere on the server (only a PostHog `ticket_viewed` event).
- Nothing in time management suggests or dismisses entries. `IntervalSection` on the timesheet is the closest pattern: it suggests, prefills `TimeEntryDialog`, and removes after saving.

### 2.5 Board setting

`boards.enable_live_ticket_timer` (NOT NULL, default true; `server/migrations/20260329120000_add_enable_live_ticket_timer_to_boards.cjs`). The `?? true` default is repeated in:
- `packages/tickets/src/lib/boardLiveTicketTimer.ts`
- `boardActions.ts` L36–45, L410, L920
- `optimizedTicketActions.ts:773`
- `BoardsSettings.tsx` L507, L892

The field is also exposed in:
- the API zod schema (`server/src/lib/api/schemas/board.ts:20,44`)
- OpenAPI (`sdk/docs/openapi/alga-openapi{,.ce,.ee}.{json,yaml}`)
- the MCP and chat registries (`server/src/lib/mcp/registry.generated.ts`, `ee/server/src/chat/registry/apiRegistry.generated.ts`)

## 3. Decisions

These answer the nine design questions on the card. Each one is a fact the build steps rely on.

**D1. Storage: a dedicated session table (option B), with mobile moved onto it.** Reusing the open time-entry row (option A) is rejected, for four reasons:
- It cannot represent pauses.
- It leaks into the ticket time list, closure validation, the activity-status action, exports, search and report counts (§2.2).
- Its stop path produces entries that never reach a timesheet.
- The fix for all of these would be an `end_time IS NOT NULL` filter on every reader, forever.

With a dedicated table, `time_entries` only ever holds finished time.

**D2. Segments are the source of truth.** A session has child segment rows, `(started_at, ended_at)`, with at most one open segment. Pausing closes the open segment and resuming opens a new one. Elapsed time is the sum of closed segments plus `now − open.started_at`, computed from server timestamps. No counter is stored that could drift from the segments. Segments also leave a record of when work happened.

**D3. One open session per user.** "Open" means running or paused, enforced by a partial unique index on `(tenant, user_id) WHERE status IN ('running','paused')`. Starting while a session is open returns a conflict that carries the open session. The UI then offers "Stop and log current, then start" or "Discard current, then start" (mobile already has the switch flow).

Allowing several paused sessions was considered and deferred. It needs a list UI in the header and on mobile, and the card asks for one per user.

**D4. "Stop" means log, not a separate state.** Sessions have two open states (`running`, `paused`) and two terminal ones (`logged`, `discarded`).
- **Web.** Stop pauses the session if it is running, then opens the existing time-entry drawer prefilled from the session. Saving the drawer creates the entry and marks the session `logged` in the same transaction. Cancelling leaves the session paused with its time intact, so it can be resumed or stopped again.
- **Mobile.** `StopTimerModal` does the same through one API call (`POST /stopwatch/{id}/log`).

There is no "stopped but not logged" state that could block the next start or be forgotten.

**D5. One entry per session, start anchored on the real first start.** A session becomes one time entry:
- `start_time` = the first segment's `started_at`, truncated to the minute.
- `end_time` = `start_time` + active duration.
- `billable_duration` = active minutes.
- Active minutes are rounded to the nearest minute, with a minimum of 1.

Keeping start, end and duration consistent with each other is required, because `TimeEntryEditForm` recomputes duration from the span on every edit (`TimeEntryEditForm.tsx:430,555`). An entry whose span includes the pause would be silently re-billed for that pause on its first edit.

When the session paused, the drawer shows a notice: "Tracked 1h 30m across 2 segments (paused 1h 0m)". The user can still edit anything before saving.

**D6. One shared time-entry write core.** The body of `saveTimeEntry`, from validation onward, moves into `packages/scheduling/src/lib/timeEntryWriteCore.ts` as `persistTimeEntry(trx, { tenant, actor, entry })`. It covers sheet checks, contract line, bucket, hour block, resources and project hours. Three callers use it:
- `saveTimeEntry` (unchanged behaviour)
- stopwatch log on the web (through `saveTimeEntry` with a session id)
- the API stopwatch log endpoint

A server-side sheet resolver (`resolveTimeSheetForWorkDate(trx, tenant, userId, workDate)`) is extracted next to it from `timeEntrySaveAdapter`'s client-side logic, so the API path can resolve sheets. `TimeEntryService.create` keeps its own thinner path in this card; it gets a `// LEVERAGE: friction time-entry-write-paths` marker so it can move onto the core later.

**D7. The legacy mobile endpoints become adapters.** The three `/api/v1/time-entries/{start-tracking,stop-tracking/{id},active-session}` routes stay, because installed mobile builds call them. They are re-implemented on the session model and marked `deprecated: true` in OpenAPI:
- start → create session
- active-session → return the session in the old response shape, with `session_id` = the session id and `start_time` = the first segment start
- stop → log through the write core

`getActiveSession` gains the `time_entry:read` check it lacks.

**D8. Existing open rows are converted, then forbidden.**
- A Phase-1 migration turns every `time_entries` row with `end_time IS NULL` into a running session with one open segment from `start_time`, then deletes the row.
- A Phase-3 migration, which ships after no code writes open rows, restores `end_time NOT NULL`. It is guarded with the Citus `run_command_on_shards` procedure from `docs/AI_coding_standards.md` §CitusDB 6 when `time_entries` is distributed.

**D9. Where the stopwatch shows.**
- **Ticket tile.** `TicketBentoLayout` `timerTile` and the `TicketProperties` Time Entry card are driven by server state: Start / Pause / Resume / Stop, and Discard (with a confirm dialog). The tile shows "Running on another ticket: #1234 Title" with a Switch action when the user's open session belongs to a different work item.
- **Header indicator.** In `server/src/components/layout/Header.tsx`, next to `NotificationBell`. It shows the running clock and the ticket number and title, links to the ticket, and has a popover with Pause/Resume/Stop. It is visible on every MSP page and hidden when there is no open session.
- **Project task detail.** Mobile already has a project-task stopwatch, so the model supports `project_task`. The web project task tile is not in this card; the header indicator still shows and stops such a session.

**D10. Client state: one provider, server timestamps.**
- A `StopwatchContext` interface lives in `packages/ui/src/context/StopwatchContext.tsx`, injected the way `SchedulingContext` is, because `packages/tickets` must not import `@alga-psa/scheduling`.
- `StopwatchProvider` (in `packages/scheduling`, mounted in `server/src/components/layout/WorkspaceProviders.tsx`) holds the user's open session.
- It refreshes with `useActionPolling` (15 s), on window focus or visibility, and on a same-browser `BroadcastChannel('alga-stopwatch')` message after any local mutation.
- It computes the server clock offset from `server_now` in every response, as mobile does.
- The 1 s ticker only re-renders. The displayed value is always derived from segments, so sleep and background throttling cannot cause an undercount.
- A Hocuspocus push room was considered: polling plus focus refresh is enough for state that only the user changes, and the clock never depends on push. It is recorded as a follow-up.

**D11. Leaving the ticket loses nothing.** Navigation does not touch the session. The unmount stop, the board-policy stop effect and `handleBackToTickets` are deleted. Discard is the only destructive action, and it always asks for confirmation.

**D12. Board setting: keep the column and change what it means.** `boards.enable_live_ticket_timer` keeps its name, default and API shape (no OpenAPI or registry break). It now means "show the stopwatch on tickets in this board". In practice:
- When it is off, the tile hides the stopwatch controls and `startStopwatch` rejects work items on that board.
- An already-open session keeps running when its ticket moves to a board with the stopwatch off; it stays visible and stoppable in the header.
- Every `?? true` default moves into `packages/tickets/src/lib/boardLiveTicketTimer.ts` (`resolveBoardStopwatchEnabled`, `normalizeBoardStopwatchSetting`). The callers in `boardActions.ts`, `optimizedTicketActions.ts` and `BoardsSettings.tsx` import it.
- The settings label and help text are rewritten in all locales, and the OpenAPI field description is updated.

**D13. Trail sources: ticket audit log only, no view capture.**
- **Source.** `ticket_audit_logs` rows with `actor_type = 'user'` and `actor_user_id = <user>`. This already covers comments, internal notes, status and field changes, assignment, documents, checklists and links, so the comments table is not read separately (that would double-count).
- **Gap fixed in this card.** `addTicketResourceCore` / `removeTicketResource` start writing `ASSIGNED`/`UNASSIGNED`-style audit rows for additional agents, with the acting user as actor.
- **Time entries.** These suppress suggestions rather than create them.
- **Ticket views.** Not captured. Opening a ticket is not work; recording views would bring back the "reading looks billable" confusion behind #3204. It would also add a write to every ticket open, for a memory aid the action trail already serves.

**D14. How the trail becomes suggestions.**
- **Derivation.** On read, there is no materialised table. The query selects the user's audit rows in the requested range, grouped by `(ticket_id, local work date in the user's timezone)`, using `resolveUserTimeZone` / `computeWorkDateFields` semantics.
- **Each suggestion carries** the ticket number and title, the client name, the work date, the first and last touch, the event count, and the distinct event kinds (for the "Commented, changed status" summary).
- **A suggestion is suppressed if:**
  - the user has any `time_entries` row for that ticket on that work date, or
  - an open stopwatch session exists on that ticket (shown as "timer running" instead), or
  - a dismissal exists for that user, ticket and date.
- **Dismissal is per ticket-day and does not come back** when later activity arrives that day. That keeps it predictable.
- **Index.** A new non-unique index on `ticket_audit_logs (tenant, actor_user_id, occurred_at)` serves the query.

**D15. Where the trail shows: suggested entries on the timesheet.**
- `SuggestedEntriesSection` replaces `IntervalSection` in the same slot of `TimeSheet.tsx` (L935), behind the existing toggle, renamed "Suggestions" and showing a count badge.
- Each row shows the date, `#number Title`, the client, "first activity 09:12 · last 11:40 · 4 actions (commented, changed status)", and buttons for Log time and Dismiss.
- Log time calls the existing `handleTimeEntrySelection` → `TimeEntryDialog` with the ticket work item and:
  - `defaultStartTime` = the first touch, rounded down to 5 min
  - `defaultEndTime` = the later of the last touch (rounded up) and start + 15 min
  - a notice saying the times are estimated from activity
- Saving goes through the normal flow, and the suggestion disappears because an entry now exists.
- Suggestions show only when the viewer may edit the sheet: the owner, or a delegate allowed by `assertCanActOnBehalf`.
- Display names only; raw IDs are never shown.
- A "today" panel is deferred.

**D16. Existing IndexedDB intervals are dropped, not imported.**
- Most of these intervals came from auto-start, so they record reading rather than work.
- The trail covers the same days from the audit log, which has existed since May 2026.
- An import would keep the IndexedDB reader alive for another release.

On the first load after deploy, a small `purgeLegacyTicketTimerStore()` calls `indexedDB.deleteDatabase('TicketTimeTrackingDB')` once and is marked with a removal date. No other IndexedDB time-tracking code remains.

**D17. Interim fix: split it out and ship it first.** The gap-billing and cross-tab cutoff bugs affect billed time in production today. Phase 3 of this card deletes the code they live in, but that is at least two PRs away. The design desk recommends a small separate card that ships first:
- `IntervalManagement.handleCreateTimeEntry` uses end = start + summed durations instead of the earliest-to-latest span.
- `cleanupOrphanOpenIntervals` only closes intervals whose lock heartbeat is stale, and closes them at the last heartbeat, capped by the 5 pm rule, instead of "now".
- `doStart` stops resetting `elapsedTime` on resume.

Creating that card is the XO's call; this plan does not depend on it.

**D18. Phasing: three stacked PRs on this card.** Each phase can merge and deploy on its own:

| Phase | Contents | Why this order |
|---|---|---|
| **P1: stopwatch backend and mobile** | Tables and migrations, stopwatch core and server actions, `/api/v1/stopwatch` routes, legacy endpoint adapters, open-row conversion, write-core extraction, mobile pause/resume and log | Every other phase depends on it. It removes open rows from `time_entries` at once. |
| **P2: work trail** | Audit index, the additional-agent audit gap, dismissal table, derivation action, `SuggestedEntriesSection` replacing `IntervalSection` | Users who used auto-start intervals as a memory aid get the replacement before those intervals go away. |
| **P3: web stopwatch and removal** | Ticket tile and header indicator, Stop → drawer, Discard confirm, auto-start retired, every IndexedDB and dead-duplicate file removed, board-setting consolidation, the `end_time NOT NULL` migration, the legacy store purge | Fixes #3204 for good. It ships last because it removes the old surfaces. |

## 4. Data model (P1, P2)

All new tables follow the pattern of `server/migrations/20261006120000_create_board_notification_rules.cjs`:
- `tenant uuid NOT NULL`, with `tenant` first in the PK and in every index.
- `ensureTenantDistribution(knex, table)` from `server/migrations/utils/citusDistribution.cjs` runs before the FKs, which are added through the `DO $$ IF NOT EXISTS` helper.
- `exports.config = { transaction: false }`.
- Each table is registered in `packages/db/src/lib/tenantTableMetadata.ts` and in the migration shim `server/migrations/utils/tenantDb.cjs`.

The tables are created empty and distributed straight away, so the stale-heap trap in citus-migration-gotchas (Gotcha 1) cannot apply. The partial unique indexes include `tenant`, so Gotcha 3 is satisfied.

**`time_tracking_sessions`**

| Column | Type | Notes |
|---|---|---|
| tenant | uuid | PK part, FK tenants |
| session_id | uuid | PK part, `gen_random_uuid()` |
| user_id | uuid | FK (tenant, user_id) → users |
| work_item_type | text | `ticket`, `project_task`; `ad_hoc` and others accepted only through the legacy adapter |
| work_item_id | uuid null | null only for legacy `ad_hoc` |
| service_id | uuid null | optional at start; required at log time |
| notes | text | default '' |
| status | text | CHECK in (`running`,`paused`,`logged`,`discarded`) |
| time_entry_id | uuid null | set when logged |
| closed_at | timestamptz null | when logged or discarded |
| created_at, updated_at | timestamptz | |

Indexes:
- `UNIQUE (tenant, user_id) WHERE status IN ('running','paused')`, which enforces D3.
- `(tenant, work_item_type, work_item_id)` for ticket-tile and trail suppression lookups.

**`time_tracking_session_segments`**

| Column | Type | Notes |
|---|---|---|
| tenant | uuid | PK part |
| segment_id | uuid | PK part |
| session_id | uuid | FK (tenant, session_id) → sessions, ON DELETE CASCADE |
| started_at | timestamptz | |
| ended_at | timestamptz null | null = open |

Indexes and checks:
- `UNIQUE (tenant, session_id) WHERE ended_at IS NULL`: at most one open segment.
- `CHECK (ended_at IS NULL OR ended_at >= started_at)`.

**`time_entry_suggestion_dismissals`** (P2)

Columns: `tenant`, `dismissal_id`, `user_id`, `work_item_type`, `work_item_id`, `work_date date`, `dismissed_at`. Unique on `(tenant, user_id, work_item_type, work_item_id, work_date)`.

**`ticket_audit_logs`** (P2)

New index `(tenant, actor_user_id, occurred_at)`. It is not unique, so there is no stale-heap risk; it is built with plain `CREATE INDEX IF NOT EXISTS`.

**`time_entries`** (P3)

Restore `end_time NOT NULL`, as described in D8.

Migrations:
- P1: `…_create_time_tracking_sessions.cjs`, then `…_convert_open_time_entries_to_sessions.cjs`. The conversion selects open rows and inserts session and segment rows with parameterised values, following the Citus UPDATE rule. It then deletes the rows and logs the count.
- P2: `…_create_time_entry_suggestion_dismissals.cjs`, `…_add_ticket_audit_logs_actor_index.cjs`.
- P3: `…_time_entries_end_time_not_null.cjs`.

## 5. Stopwatch core (P1)

`packages/scheduling/src/lib/stopwatch/`:

- `stopwatchMath.ts` (pure):
  - `activeMs(segments, now)`
  - `isRunning(segments)`
  - `firstStart(segments)`
  - `toEntrySpan(segments, now) → { start, end, billableMinutes, pausedMs, segmentCount }` (D5 rounding)
  - `clockOffset(serverNow, receivedAt)`
- `stopwatchCore.ts` (transaction level; takes `trx, tenant, actorUserId`):
  - `getOpenSession`
  - `startSession({workItemType, workItemId, serviceId?, notes?})`: checks the work item exists and, for tickets, the board flag (D12). It inserts the session and its open segment. On a unique violation it throws `StopwatchConflictError` carrying the open session. Constraint names are matched with the `_<shardid>` suffix stripped (Citus Gotcha 2).
  - `pauseSession` / `resumeSession`: `SELECT … FOR UPDATE` on the session. Each is idempotent: pausing a paused session returns it unchanged.
  - `discardSession`
  - `updateSessionDraft({notes, serviceId})`
  - `logSession(sessionId, entryInput)`: pauses the session if running, builds the entry from `toEntrySpan` with caller overrides, calls `persistTimeEntry` (D6), and sets `status='logged'`, `time_entry_id` and `closed_at`, all in one transaction.
  - Every read returns `StopwatchSessionView`: the session fields, `segments`, `active_ms`, `status`, `server_now`, and display fields (ticket number and title, client name, service name).
- Workflow events: `logSession` keeps publishing the existing ticket-time-entry-added event through `persistTimeEntry` / `buildTicketTimeEntryAddedWorkflowEvent`. Start, pause and resume publish nothing new.

`packages/scheduling/src/actions/stopwatchActions.ts` (`withAuth`). All of them act on the caller's own session:

| Action | Behaviour |
|---|---|
| `getMyStopwatch()` | Needs `time_entry:read`. Returns the open session, or null. |
| `startStopwatch(input)` | Needs `time_entry:create`, plus `ticket:read` on the ticket. Returns the session, or `{ conflict: StopwatchSessionView }`. |
| `pauseStopwatch(id)` / `resumeStopwatch(id)` | |
| `discardStopwatch(id)` | |
| `updateStopwatchDraft(id, input)` | |

`saveTimeEntry` accepts an optional `stopwatch_session_id`. When it is present, the save calls `logSession` semantics inside its transaction, so the entry and the session close together.

Expected errors use the `TimeSheetActionError` style (`timeSheetActionErrors.ts`); they are not thrown strings.

## 6. API (P1)

New routes under `server/src/app/api/v1/stopwatch/`, with a thin route file, `ApiStopwatchController` and `StopwatchApiService`. The service delegates to `stopwatchCore`, the same way `TimeSheetService` already imports `@alga-psa/scheduling`.

| Method and path | RBAC | Body | Result |
|---|---|---|---|
| GET `/api/v1/stopwatch/active` (`?user_id=` optional) | `time_entry:read`; another user's session only through `assertCanActOnBehalf` rules | | session or `null` |
| POST `/api/v1/stopwatch` | `time_entry:create` | `{work_item_type, work_item_id, service_id?, notes?}` | 201 session; 409 with `details.open_session` |
| POST `/api/v1/stopwatch/{id}/pause` | `time_entry:create` | | session |
| POST `/api/v1/stopwatch/{id}/resume` | `time_entry:create` | | session |
| PATCH `/api/v1/stopwatch/{id}` | `time_entry:create` | `{notes?, service_id?}` | session |
| POST `/api/v1/stopwatch/{id}/log` | `time_entry:create` | `{start_time?, end_time?, billable_duration?, is_billable?, notes?, service_id?}` | 201 `{session, time_entry}` |
| DELETE `/api/v1/stopwatch/{id}` | `time_entry:create` | | 204 (discard) |

The `log` endpoint resolves the sheet server-side (D6). It returns a 409 if the target period's sheet is locked (submitted or approved).

Legacy adapters (D7) are handled in `ApiTimeEntryController.startTracking/stopTracking/getActiveSession` and the `TimeEntryService` tracking methods, rewritten to call `stopwatchCore`.

Artifacts to update:
- Zod schemas: `server/src/lib/api/schemas/stopwatch.ts`.
- OpenAPI: `server/src/lib/api/openapi/routes/workManagementV1.ts`, with the legacy routes marked deprecated.
- Regenerate `sdk/docs/openapi/alga-openapi{,.ce,.ee}.{json,yaml}` (`cd sdk && npm run openapi:generate`), `docs/openapi/route-inventory.json` and `schema-coverage.json`.
- Regenerate the MCP and chat registry (`npm run mcp:registry:generate`).

## 7. Mobile (P1)

`ee/mobile/src/api/timeTracking.ts` → `stopwatch.ts`, calling the new routes.

`TimerContext.tsx`:
- `TimerStatus` gains `paused`.
- The session now carries `segments` and `active_ms`.
- `useTimerElapsedMs` derives elapsed time from the segments plus the clock offset.
- New `pause()`, `resume()` and `discard()`. The switch flow uses the 409 `open_session`.

`StopTimerModal` calls `/log`:
- Prefilled from `toEntrySpan`, which is shared by copying `stopwatchMath.ts` into `ee/mobile/src/features/timer/stopwatchMath.ts` with a parity test. The mobile workspace does not consume `@alga-psa/scheduling`.
- It shows the paused-time notice.

`HeaderTimerChip` and `TicketTimerChip` get a paused state. Reminder notifications only fire while the session is running.

Mobile i18n: add keys to every shipped mobile locale.

## 8. Work trail (P2)

`packages/scheduling/src/lib/workTrail/deriveSuggestions.ts` (pure):
- Input: audit touches `{ticket_id, occurred_at, event_type}`, the user's timezone, logged `(ticket_id, work_date)` pairs, open-session ticket ids, and dismissals.
- Output: `TimeEntrySuggestion[]`, sorted by date, then by first touch.

`packages/scheduling/src/actions/workTrailActions.ts`:
- `getTimeEntrySuggestions({ userId, startDate, endDate })` (`withAuth`, owner or delegate):
  - one query on `ticket_audit_logs` using the new index, joined to `tickets` and `clients` for display names
  - one query on `time_entries` by `(tenant, user_id, work_date)` (existing index)
  - one query on open sessions and dismissals
- `dismissTimeEntrySuggestion({ userId, ticketId, workDate })`.

Shared audit gap: `shared/services/tickets/ticketResourceCore.ts` writes audit rows through `writeTicketActivity` when an additional agent is added or removed, with the acting user as actor.

UI:
- `packages/scheduling/src/components/time-management/time-entry/time-sheet/SuggestedEntriesSection.tsx`, using `Card`, `Button` and `Badge`, following `docs/ui/design_guidelines.md`.
- In `TimeSheet.tsx`, it replaces `IntervalSection` (L935) and the toggle. Log time goes through `handleTimeEntrySelection` (D15). After a save or dismiss, the suggestions refetch.
- Element ids follow the reflection guidelines (`time-sheet-suggestion-{ticketId}-{date}-log`).

## 9. Web stopwatch UI and removal (P3)

New:
- `packages/ui/src/context/StopwatchContext.tsx`: the interface, a no-op default, and `useStopwatch()`.
- `packages/scheduling/src/providers/StopwatchProvider.tsx`: state, polling, `BroadcastChannel`, clock offset.
- `packages/scheduling/src/components/stopwatch/StopwatchDiscardDialog.tsx`, using `ConfirmationDialog`.
- `server/src/components/layout/StopwatchHeaderIndicator.tsx`, rendered in `Header.tsx` next to `NotificationBell`; strings in `msp/core`.
- `packages/tickets/src/components/ticket/TicketStopwatchControls.tsx`: one presentational component used by both `TicketBentoLayout.timerTile` and the `TicketProperties` Time Entry card. This replaces two copies of the clock markup.
- `stopwatchSessionToTimeEntryContext(session)` in `packages/tickets/src/lib/timeEntryContext.ts`. It builds `TimeEntryWorkItemContext` with the explicit `startTime` and `endTime` from `toEntrySpan`, a paused notice, and `stopwatchSessionId`.
- `TimeEntryWorkItemContext` gains `stopwatchSessionId?` and `notice?`. `launchTimeEntryForWorkItem` passes the session id into `saveTimeEntry`.
- The stop flow is the same from the tile and the header: `pause` → `launchTimeEntry(context)`. Saving logs the session (D4); closing the drawer keeps it paused.

Changed:
- `TicketDetails.tsx`:
  - Delete the timer state and tick (L1330, L1512–1528), `intervalService`, `holderId`, the hook call, the auto-start, board-policy and lock-poll effects (L1603–1681), `closeCurrentInterval`, `handleBackToTickets`, the start/pause/stop handlers and the unmount stop (L1685–1790).
  - Delete the `renderIntervalManagement` prop.
  - `handleAddTimeEntry` no longer passes `elapsedTime`.
  - The tile reads `useStopwatch()`.
- `TicketBentoLayout.tsx`, `TicketProperties.tsx`: replace the clock props with `TicketStopwatchControls`; drop `renderIntervalManagement`, `isTimerLocked`, `elapsedTime`, `isRunning` and `onStart/onPause/onStop`.
- `TicketDetailsContainer.tsx`, `MspTicketDetailsContainerClient.tsx`: drop the interval plumbing.
- `timeEntryContext.ts`: delete `createTicketTimeEntryOnComplete`'s stop/reset logic and the `elapsedTime` parameter.
- `timeEntryPeriodSelection.ts`: delete the `elapsedTime` branch (L167). `scheduling.interfaces.ts:139`: delete `elapsedTime`.
- `TicketingDashboard.tsx`: drop `useIntervalTracking`.
- `BoardsSettings.tsx`, `boardActions.ts`, `optimizedTicketActions.ts`: use the consolidated helpers (D12) and the new label and help text.
- `server/src/components/layout/WorkspaceProviders.tsx`: mount `StopwatchProvider`.

Deleted:
- `packages/ui/src/services/IntervalTrackingService.ts` and its `services/index.ts` export.
- `packages/ui/src/hooks/useTicketTimeTracking.ts`, `useIntervalTracking.ts` and their `hooks/index.ts` exports.
- `packages/scheduling/src/components/time-management/interval-tracking/` (whole directory; `IntervalSection` is already replaced in P2).
- `packages/types/src/lib/interval-tracking.ts` and its export.
- `server/src/services/IntervalTrackingService.ts`, `server/src/hooks/useTicketTimeTracking.ts`, `server/src/hooks/useIntervalTracking.ts`, `server/src/types/interval-tracking.ts`.

The legacy store purge (D16) lives in `StopwatchProvider` mount, gated by a `localStorage` flag.

## 10. Internationalisation

New and changed keys:

| Namespace | Keys |
|---|---|
| `features/tickets` | tile: start, pause, resume, stop, discard, running elsewhere, switch, board-disabled text |
| `msp/core` | header indicator |
| `msp/time-entry` | stop notice, discard dialog, conflict dialog, suggestions section, dismiss |
| `msp/settings` (`BoardsSettings.tsx:483`) | board setting label and help |

Every shipped locale is filled: `en fr es de nl it pl pt sv`. Then:
- run `node scripts/generate-pseudo-locales.cjs` for `xx` and `yy`
- run `npm run test:i18n` (validation, audit, untranslated-UI check)

Strings for the old interval UI are removed.

## 11. Tests (80/20)

| Phase | Test | Kind | Covers |
|---|---|---|---|
| P1 | `packages/scheduling/src/lib/stopwatch/__tests__/stopwatchMath.test.ts` | unit | active time across pause/resume, open segment, D5 rounding and 1-minute floor, `toEntrySpan` start, end and duration consistent, clock offset |
| P1 | `server/src/test/integration/stopwatch/stopwatchCore.integration.test.ts` | integration (real DB) | start/pause/resume wall-clock persistence; second start → conflict carrying the open session; concurrent starts → exactly one row (unique index); board flag off → start rejected; discard; idempotent pause |
| P1 | `…/stopwatchLog.integration.test.ts` | integration | log produces one entry with the right start, end and `billable_duration`, a `time_sheet_id`, a resolved contract line and a bucket draw; session `logged` with `time_entry_id`; locked sheet → error and session still paused |
| P1 | `server/src/test/e2e/api/stopwatch.e2e.test.ts`, plus updating `time-entries.e2e.test.ts:685–723` | e2e | new routes, RBAC, legacy adapters keep their response shape |
| P1 | migration test for the open-row conversion | integration | open row becomes a running session with one segment; the row is gone |
| P1 | `ee/mobile` `stopwatchMath` parity and `TimerContext` paused state | unit | |
| P2 | `deriveSuggestions.test.ts` | unit | group by ticket per local day, first and last touch, timezone boundary, suppression by entry, open session and dismissal |
| P2 | `workTrailActions.integration.test.ts` | integration | real audit rows from comment and status actions produce a suggestion; a logged entry hides it; only the owner or a delegate sees it |
| P3 | `TicketStopwatchControls.test.tsx` | unit | renders from session state; hidden when the board flag is off; "running elsewhere" variant |
| P3 | `StopwatchProvider.test.tsx` | unit | elapsed time derived from segments, not ticks (fake timers jump 10 min with no ticks → shows 10 min) |
| P3 | `TicketDetails.stopwatch.test.tsx` | unit | opening a ticket calls no start action; Stop opens the drawer with the session span |
| P3 | `boardLiveTicketTimer.test.ts` | unit | resolver and normalizer defaults |

Tests replaced:
- `TicketDetails.liveTimerPolicy.test.tsx` and `TicketProperties.liveTimerPolicy.test.tsx` are replaced by the P3 tests above.
- The `useTicketTimeTracking` and `@alga-psa/ui/services` mocks are removed from `TicketDetails.updatedBy.localSave`, `.resolutionClosePrompt`, `.remoteUpdates`, `TicketDetailsCreateTask` and `.bundlePropagationConfirm`.
- `MspTicketDetailsContainerClient.contract.test.ts:16` and `TicketBentoLayout.addTimeEntry.test.tsx` are updated.
- The `elapsedTime` cases in `timeEntryPeriodSelection.test.ts:149–169` are removed.

`server/src/test/integration/boardLiveTicketTimerSetting.integration.test.ts` is kept, and the start-rejection case is added to it.

## 12. Risks

- **Rolling deploy and old mobile builds.** The legacy adapters keep old builds working. The `NOT NULL` migration waits until P3, so no old pod can still be writing open rows when the constraint arrives.
- **`time_entries` distribution in production is unconfirmed.** A fresh migration chain leaves it local (`ee/docs/plans/2026-09-05-production-regression-prevention/SCRATCHPAD.md`). The P3 migration branches on `pg_dist_partition`. Run the read-only `citus_tables` check from the citus-migration-gotchas skill before merging P3.
- **Moving `saveTimeEntry` into a shared core** touches the busiest time-entry path. The extraction is mechanical, and its existing tests must pass unchanged before any stopwatch code calls the core.
- **Trail noise from bulk edits.** Bulk ticket updates write one audit row per ticket with the user as actor, so a bulk status change produces many suggestions. Acceptable for a dismissable memory aid; a "Dismiss all for this day" action is included in the section.
- **The legacy IndexedDB store is dropped** (D16). Unlogged local intervals are lost by design; the trail covers the same days.

## 13. Not included

- Automatic billing from the trail.
- Capturing ticket views.
- Several paused sessions per user.
- Hocuspocus push for stopwatch state.
- A web project-task stopwatch tile.
- A manager view of other users' running timers (the API supports it; no UI yet).
- A "today" panel.
- Moving `TimeEntryService.create` onto the write core (left as a LEVERAGE marker).
- Replying to GitHub #3204. Robert does that once this ships; the Update PSA Ticket step should note it on alga0002288.
