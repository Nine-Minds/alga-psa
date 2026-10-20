# Activities cards view: inline filters at parity with the table view

Card 48bde518 · PSA ticket alga-2026-0002759 · branch `feature/activities-grid-view-inline-filters-at-parity-wi`

Screen: `/msp/user-activities`, cards view ("grid"). All paths below are relative to
`packages/user-activities/src/` unless noted.

## 1. How each view filters today

### Table view (the reference)

| Concern | Where | Mechanism |
|---|---|---|
| Filter UI | `components/filters/ActivitiesTableFilters.tsx` (controlled: `filters` + `onChange`) | Inline bar |
| Filter state | `components/ActivitiesDataTableSection.tsx:203-237, 474-480` | `useState<ActivityFilters>`, mirrored from the `activitiesTableFilters` user preference (localStorage, then server, debounced 1 s) until the first user edit (`userEditedFiltersRef`); "View All" `initialFilters` count as explicit and bypass the mirror |
| Option data | `ActivitiesDataTableSection.tsx:247-390` | priorities (only when exactly one of ticket/project is selected), clients, projects with phases and statuses, boards, ticket statuses, ticket and project-task tags |
| "Viewing" user | `ActivitiesDataTableSection.tsx:147-168, 487-490, 700-720` | `targetUserId` (in memory, not persisted), gated by `getActivityViewableUsers`; read-only rendering when viewing someone else |
| Query | `ActivitiesDataTableSection.tsx:395-429` → `hooks/useActivitiesCache.ts:71` → `fetchActivities` → `actions/activityAggregationActions.ts:221 collectProcessedActivities` | Server-side. Each per-type fetcher applies the SQL-level filters, then `processActivities` (`:1257`) applies the cross-type ones (search, status, priority, due range, created range, assignee), sorts (default: priority, then due date), and paginates |
| Refresh | `ActivitiesDataTableSection.tsx:447-455` | Listens to `useActivitiesInvalidationSignal`, so drawer edits refetch (from parent card alga0002041) |

Filters the bar exposes (`ActivitiesTableFilters.tsx:629-962`):

- Types: Schedule, Project Tasks, Tickets, Workflow Tasks. Empty means all types (`ActivitiesDataTableSection.tsx:397-399`).
- Show closed (`isClosed`) and Reset (back to `DEFAULT_TABLE_TYPES` with `isClosed:false`).
- Search (`search`).
- Client (`clientId`).
- Priority (`priorityIds`), shown only when the only selected type is Ticket or Project Task.
- Deal work (`opportunityScope`), shown only while Schedule is selected.
- Tickets group: board include/exclude, status include/exclude (name-deduplicated across boards), ticket tags.
- Tasks group: project, phase and status tree with include/exclude, task tags.
- Due date range (`dueDateStart`/`dueDateEnd`) and created date range (`createdAtStart`/`createdAtEnd`).
- Outside the bar, in the section header: Viewing user (`targetUserId`).

### Cards view

`components/UserActivitiesDashboard.tsx:146-226` renders five independent sections. Each one has
its own state, its own fetcher, its own modal filter dialog, and no access to the table's filter
model:

| Section | Fetch | Dialog filters | Gap against the table |
|---|---|---|---|
| Schedule (`ScheduleSection.tsx:30-153`) | `fetchScheduleActivities`: per-type, **no `processActivities`, no opportunity or marketing items** | search, isClosed, isRecurring, workItemType, date window | No client, deal-work scope, due or created range. Deal steps and marketing posts never appear, although the table's Schedule type includes them (`activityAggregationActions.ts:250-256`) |
| Tickets (`TicketsSection.tsx:32-145`) | `fetchTicketActivities` (per-type) | search, client, contact, priority, due, created, isClosed | No boards, statuses, tags or exclusions. Search, due and created run only through whatever the SQL fetcher applies, not `processActivities` |
| Projects (`ProjectsSection.tsx:32-140`) | `fetchProjectActivities` (per-type) | search, single project and phase, priority, due, created, isClosed | No project/phase/status tree, exclusions, tags or client |
| Workflow Tasks (`WorkflowTasksSection.tsx:30-112`) | `fetchDashboardWorkflowTasks` | search, execution (built only from the 5 loaded rows, `:50-77`), due, created, includeHidden, isClosed | No client or created range applied through the shared path |
| Notifications (`NotificationsSection.tsx:63-240`) | `fetchNotificationActivities(Paged)` | read state, category (stored in `search`), priority, date range | Not part of the table's type set (`constants.ts:7`), so there is nothing to match |

Other defects in the cards view that this work removes as a side effect:

- None of the four activity sections listen to `useActivitiesInvalidationSignal`, so drawer edits
  do not refresh the cards. The parent card fixed this for the table only.
- Each section re-implements load, sort, error and refresh, and `isFiltersActive` appears four
  times. The `// LEVERAGE: pattern activity-dialog-date-range` markers in three dialogs already
  record the duplication.
- "View All" (`UserActivitiesDashboard.tsx:94-100`) replaces every filter with
  `{types:[X], isClosed:false}`, so the table opens unfiltered.

**Root cause.** The cards view has no filter layer of its own and does not use the table's. Each
section built a private filter set and fetches through per-type actions that skip the shared
cross-type pipeline (`collectProcessedActivities` plus `processActivities`). Parity therefore
needs two things: the same UI (the filter bar), and the same query path (`fetchActivities` with
`types:[sectionType]`). If the sections keep their per-type fetchers, the semantics cannot match,
whatever UI they get.

## 2. Design

### 2.1 One filter model for the whole screen

`UserActivitiesDashboard` owns one filter state that both views consume. Switching views keeps
the filters, and "View All" carries them over. The filters are persisted in the existing
`activitiesTableFilters` user preference. No new preference key is added, so existing saved
filters keep working in both views.

The state is lifted to the dashboard instead of instantiating the hook once per view. Each
remount would re-run `useUserPreference`'s server fetch while the 1 s debounced write is still
pending, and the stale server value would overwrite a filter edited just before the switch.

New hook `hooks/useActivityFilterState.ts` is extracted verbatim from
`ActivitiesDataTableSection.tsx:203-237, 474-480, 149, 487-490`:

```ts
interface ActivityFilterState {
  filters: ActivityFilters;          // effective filters (override ?? user/saved)
  isReady: boolean;                  // saved prefs resolved, or an override is active
  hasOverride: boolean;              // a View All / deep-link override is in effect
  setFilters(f: ActivityFilters): void;      // user edit: persists, ends the saved-pref mirror, clears override
  setOverrideFilters(f: ActivityFilters): void; // this visit only, not persisted (View All, deep-link "Clear filters")
  clearOverride(): void;
  targetUserId: string;              // '' = me; in memory only, as today
  setTargetUserId(id: string): void;
}
function useActivityFilterState(opts?: { initialOverride?: ActivityFilters }): ActivityFilterState
```

Its semantics match today's table: the saved-preference mirror runs until the first user edit,
and overrides block the mirror. The rule the hook exists to protect stays in it: never latch the
first default (see the comment at `ActivitiesDataTableSection.tsx:228-232`).

`ActivitiesDataTableSection` gets an optional `filterState?: ActivityFilterState` prop.

- When the prop is passed (the dashboard), the section is controlled.
- When it is absent, a thin `SelfManagedActivitiesDataTableSection` wrapper calls the hook and
  renders the same inner component. Standalone use and the existing deep-link and focus tests
  keep working unchanged.
- `handleClearFiltersForFocus` becomes `setOverrideFilters({ types: DEFAULT_TABLE_TYPES })`.
- The deep-link `setTargetUserId('')` uses the lifted setter.
- `focusReady` uses `filterState.isReady` in place of
  `filtersLoaded || hasExplicitFilters || focusFiltersCleared`.

Dashboard changes:

- `handleViewAll(types)` calls `setOverrideFilters({ ...filters, types })` and switches the view
  ephemerally. The table now opens with the grid's filters, narrowed to that type.
- The title reads "Filtered Activities" while `hasOverride` is true.
- `handleViewChange` (an explicit ViewSwitcher click) calls `clearOverride()` for both targets.
  Today it resets only when switching to the table. Without this, a View All narrowing would
  leave the cards view showing a single section.
- `tableInitialFilters` and `currentTableFilters` are deleted.

### 2.2 Shared option data

New hook `hooks/useActivityFilterOptions.ts`, moved verbatim from
`ActivitiesDataTableSection.tsx:247-390`:

```ts
function useActivityFilterOptions(types: ActivityType[] | undefined): {
  priorities; clients; projects; boards; ticketStatuses; ticketTags; projectTaskTags;
}
```

The dashboard calls it once, so option data loads once per screen visit instead of once per view
mount. It passes the result to the table (new optional `filterOptions` prop; the self-managed
wrapper calls the hook itself) and to the cards view.

### 2.3 Cards view renders the same bar inline

New `components/ActivitiesCardsView.tsx` takes over the two card layouts now inlined in the
dashboard (`UserActivitiesDashboard.tsx:146-226` standard, `:257-358` focus mode).

- It renders `<ActivitiesTableFilters filters onChange={setFilters} {...options} />` directly
  above the Schedule section, in both layouts.
- The bar sits below the Notifications card on purpose. Notifications is not one of the bar's
  types, so placing the bar there shows which sections it governs.
- Section visibility follows Types. A section renders when its type is selected; when no type is
  selected, all four render, mirroring the table's "empty means all".
- Every other bar control works as in the table because the query is identical (2.4). The
  priority control appears only when exactly one of Ticket or Project Task is selected, and Deal
  work only while Schedule is selected. Those are the bar's own rules, so no grid-specific logic
  is involved.
- The dashboard passes the `ActivityFilterState` and options into `ActivitiesCardsView`.

The shared bar keeps the name `ActivitiesTableFilters`; this work does not rename it. One
in-place fix goes in because it is shared-layer and clearly correct:

- `selectedPriorityId` (`ActivitiesTableFilters.tsx:89-91`) is `useState` seeded once from props,
  so it goes stale when filters arrive or change from outside. That now happens on every view
  switch and with late preference hydration.
- Fix: derive it as `filters.priorityIds?.[0] ?? 'all'`, and delete the state and its setters at
  `:110, :149, :160`.

### 2.4 Sections query through the table's pipeline

New hook `hooks/useActivitySectionFeed.ts`. It is the single replacement for the four
copy-pasted load, sort and refresh blocks.

```ts
function useActivitySectionFeed<T extends Activity>(
  type: ActivityType,
  filters: ActivityFilters,
  targetUserId: string,
  limit: number,
  extra?: Pick<ActivityFilters, 'collapseRecurringSeries'>
): { activities: T[]; totalCount: number; loading: boolean; error: string | null; refresh(): void }
```

- It calls `useActivitiesCache().getActivities({ ...filters, types: [type], targetUserId: targetUserId || undefined, ...extra }, 1, limit)`.
  That is the table's own call through the shared `ActivitiesCacheProvider` cache (mounted
  workspace-wide in `server/src/components/layout/WorkspaceProviders.tsx:44`).
- There is no `sortBy`. The server's default sort (priority, then due date, then newest) is the
  table's default, and it is what the Tickets, Projects and Workflow sections already do on the
  client.
- It subscribes to `useActivitiesInvalidationSignal` with the same skip-initial-version guard as
  `ActivitiesDataTableSection.tsx:449-455`. `refresh()` calls `invalidateCache()` and reloads.
- Request ids guard against out-of-order responses: rapid typing in search fires one request per
  keystroke per section, and only the latest may commit.

Migration per section:

- **Schedule.** Uses `feed(SCHEDULE, …, { collapseRecurringSeries: true })` and drops its own
  sort and dedupe (`:68-149`). The ad-hoc quick-add calls `feed.refresh()`.
  - Deal steps and marketing posts now appear, as in the table.
  - The default window is unchanged: with no `dateRange*`, `fetchScheduleActivities` already uses
    now to +30 days (`activityAggregationActions.ts:556-565`).
  - Ordering moves from start ascending to the table's default. For Medium items that is due date
    (= `scheduled_end`) ascending, which is effectively the same.
- **Tickets, Projects, Workflow Tasks.** Use `feed(TYPE, …)`. The private filter state, option
  loading, `isFiltersActive`, `handleApplyFilters`, `handleResetFilters`, client-side sort, and
  the header's Filter/Reset buttons are removed. Refresh and View All stay.
- `WorkflowTaskCard.onActionComplete` calls `feed.refresh()`.
- Props become `{ limit, onViewAll, filters, targetUserId, readOnly }`.

**Recurring-series collapse.** The table dedupes recurring series client-side, per page
(`ActivitiesDataTableSection.tsx:94-116, 522-524`). Applied to a 5-row preview, that can show
fewer than 5 rows, which is a regression from today's Schedule card. The collapse therefore moves
before pagination:

- New pure `lib/recurringSeries.ts` exports `collapseRecurringSeries(activities)` (moved from
  `dedupeRecurringActivities`).
- New `ActivityFilters.collapseRecurringSeries?: boolean` (in
  `packages/types/src/interfaces/activity.interfaces.ts`) is applied in `processActivities` after
  filtering and before sorting. Pagination and `totalCount` therefore count series, not
  occurrences.
- `ActivitiesDataTableSection` imports the pure function for its own per-page dedupe, so one copy
  remains. The table does **not** set the flag in this card (see §5).
- `processActivities` is exported for tests. The module is not `'use server'`, so exporting a sync
  function is safe.

### 2.5 Viewing user in the cards view

"Viewing" is a table query parameter (`targetUserId`), so parity includes it.

- Extract `components/ViewingUserPicker.tsx` and `hooks/useViewableUsers.ts` from
  `ActivitiesDataTableSection.tsx:149-166, 700-720`. Both views render the picker, bound to the
  lifted `targetUserId`. In the cards view it sits at the start of the filter row.
- When viewing someone else (`readOnly`), the cards view:
  - passes `readOnly` to the cards. `ActivityCard` gets a `readOnly` prop that hides
    `ActivityActionMenu` (`ActivityCard.tsx:94-95`), mirroring `ActivitiesDataTable readOnly`.
  - hides the Schedule ad-hoc quick-add.
  - hides the Notifications card. Notifications are personal, and the server already strips them
    for other users (`activityAggregationActions.ts:241-245`).
  - still opens the drawer on click, as the table does.

### 2.6 Notifications: inline, outside the shared bar

The table has no notification-specific filters, and its type list omits Notifications, so the
notification inbox controls are not a parity question. The order still requires inline filters
instead of a dialog, so:

- New `components/filters/NotificationInlineFilters.tsx` sits inside the Notifications card,
  under the existing Unread/Read/All tabs. It holds:
  - Category (the dialog's select; still written to `search`, as the dialog does today)
  - Priority, as the existing chips, now shown in both the preview and full modes (today they
    appear only in `fullMode`)
  - Date range (`dateRangeStart`/`dateRangeEnd`)
  - an × clear control when any of these is set
- The keys and server behaviour are unchanged. Remove `isFilterDialogOpen` and the header's
  Filter/Reset buttons. The tabs already own read state.
- Add `// LEVERAGE: friction notification-category-in-search — category is smuggled through ActivityFilters.search, which processActivities also treats as a title/description substring` next to the category write.

### 2.7 Retire the dialogs

- Delete `filters/{Schedule,Ticket,Project,WorkflowTasks,Notification}SectionFiltersDialog.tsx`.
- Remove the `NotificationSectionFiltersDialog` export from `components/index.ts:4`. No consumer
  exists outside the package.
- Remove the dialogs' `LEVERAGE: pattern activity-dialog-date-range` markers along with them. The
  pattern resolves to the single date-range blocks in the bar.
- Remove the now-unused locale keys from every `server/public/locales/*/msp/user-activities.json`:
  - `sections.{schedule,tickets,projects,workflowTasks}.filterDialog.*`
  - `sections.{…}.actions.filter|reset`
  - `sections.{…}.ariaLabels.filter`
  - the notification `filterDialog.*` keys that the inline row does not reuse
- Run `npm run test:i18n`. The pseudo-locales are regenerated by that script.

### 2.8 URL state, pagination, sorting (explicit decisions)

- **URL.** The table keeps filters in the user preference, not the URL, and so does the grid.
  The existing URL params (`focus`, `activity`, `notificationTab`) are unchanged.
- **Pagination.** Sections stay fixed previews (`limit` = 5), page 1 of the shared query. "View
  All" is the pager: it opens the table with the same filters narrowed to the type.
- **Sorting.** The grid has no column headers. It uses the table's server default sort, and no
  sort UI is added.

## 3. Tests (vitest + jsdom, colocated, following `ActivitiesCacheRefresh.test.tsx` mocking style)

| File | Asserts |
|---|---|
| `lib/recurringSeries.test.ts` | Collapses the same title, workItemId and workItemType series to the first occurrence. Keeps non-recurring and non-schedule items. Preserves order |
| `actions/processActivities.test.ts` | With `collapseRecurringSeries`, recurring duplicates are removed **before** sort and slice, so `totalCount` counts series. Without the flag the output is unchanged (guards the table path) |
| `hooks/useActivityFilterState.test.tsx` | Mirrors late saved prefs (localStorage, then server) until the first `setFilters`, then stops. `setFilters` persists. `setOverrideFilters` does not persist and blocks the mirror. `clearOverride` restores the saved filters. `isReady` covers both paths |
| `hooks/useActivitySectionFeed.test.tsx` | Calls `fetchActivities` with `({ ...filters, types:[TICKET], targetUserId }, 1, 5)`, including every bar key (boards, status exclusions, tags, project tree, opportunityScope, dueDate*, createdAt*, clientId, search, isClosed, priorityIds). Refetches on a filter change. Refetches on an invalidation-version bump, not on mount. Ignores a stale out-of-order response |
| `components/ActivitiesCardsView.test.tsx` | Renders the bar inline (`#activities-search-input`, type checkboxes present) and no `Filter` buttons or dialogs. Unchecking Tickets hides `#tickets-activities-card`. Empty types show all four. Typing a search, picking a board, or toggling Show closed reaches every visible section's query. Reset restores `DEFAULT_TABLE_TYPES` with `isClosed:false` and refetches. The focus layout renders the bar too. `readOnly` hides action menus, quick-add and Notifications |
| `components/UserActivitiesDashboard.filters.test.tsx` | Filters survive cards → table → cards via the ViewSwitcher (one `useUserPreference` instance, value unchanged). View All from the Tickets section opens the table with `{ ...gridFilters, types:[TICKET] }` and does not write the preference. A ViewSwitcher click clears that override |
| `components/ActivitiesTableFilters.test.tsx` | The priority select reflects `filters.priorityIds` when the prop changes after mount (regression for the derived-state fix) |
| `components/NotificationsSection.test.tsx` | The inline category, priority and date controls write `search`, `priority` and `dateRange*`. No dialog. Chips are visible in preview mode |
| Existing: `ActivitiesDataTableSection.deepLink/focus`, `ActivitiesCacheRefresh`, `UserActivitiesDashboard.focus` | Must pass unchanged. They exercise the self-managed fallback and the lifted deep-link path |

Run `npx vitest run` in `packages/user-activities`, then `npm run test:i18n`, a typecheck, and
lint.

Browser check on the dev origin (port 3118), cards view:

1. Every bar control narrows the right sections.
2. Filters survive a reload and a view switch.
3. View All carries the filters to the table.
4. A drawer edit refreshes a card.
5. Viewing another user is read-only.

## 4. Ordering (each step green before the next)

1. `lib/recurringSeries.ts`, the `collapseRecurringSeries` filter key with `processActivities`
   wiring, the export, and tests. The table switches to the pure function, with no behaviour
   change.
2. Extract `useActivityFilterState`, `useActivityFilterOptions` and `useViewableUsers` /
   `ViewingUserPicker` from `ActivitiesDataTableSection`. Add the `filterState` and
   `filterOptions` props plus the self-managed wrapper. Make the priority-select derived-state
   fix. The existing tests must stay green without edits.
3. Lift the state into `UserActivitiesDashboard`: controlled table, View All override,
   ViewSwitcher `clearOverride`, deletion of `tableInitialFilters`. Dashboard filter tests.
4. `useActivitySectionFeed` and its tests. Migrate Schedule, Tickets, Projects and Workflow Tasks.
   Remove their dialogs and the header Filter/Reset buttons.
5. `ActivitiesCardsView`: inline bar in both layouts, type-driven visibility, `readOnly`
   plumbing, and the `ActivityCard` `readOnly` prop. Tests.
6. `NotificationInlineFilters` and retirement of the Notifications dialog plus its barrel export.
7. Delete the dialog files, clean the locale keys, run `test:i18n`.
8. Full package test run, typecheck, browser check.

## 5. Deliberately not done

- **Dialog-only filters the table never had are dropped with the dialogs.** If any of them is
  wanted, it belongs in `ActivitiesTableFilters`, which would give it to both views, as a
  follow-up. The dropped filters:
  - Schedule: `isRecurring`, `workItemType`, explicit date window
  - Tickets: `contactId`
  - Projects: single `projectId`/`phaseId`, superseded by the project tree
  - Workflow Tasks: `executionId` (its options came only from the 5 rows on screen),
    `includeHidden`
- **Table recurring collapse stays per page.** The table keeps its per-page dedupe and does not
  set `collapseRecurringSeries`. Turning the flag on would fix its `totalCount` and short pages,
  but it changes table pagination and print output, so it is a separate change. A
  `// LEVERAGE: friction recurring-collapse-per-page` marker goes at
  `ActivitiesDataTableSection` `filteredActivitiesForTable`.
- **No URL-encoded filters.** The table has none.
- **No grid sort UI and no grid pagination.** View All is the pager.
- **Notification search semantics are not fixed.** `search` is overloaded as category, and the
  table's free-text search on Notifications requires `category == text`. The friction is only
  marked.
- **The per-type server actions are not deleted.** `fetchTicketActivities`,
  `fetchProjectActivities`, `fetchScheduleActivities` and `fetchDashboardWorkflowTasks` lose
  their UI caller but are exported server actions and may have other callers (API, mobile).
- **`ActivitiesTableFilters` is not renamed** to a view-neutral name.

## 6. Risks

- **Behaviour change in the Schedule card.** It now includes deal steps and marketing posts, and
  is ordered by the table's sort. This is correct per "same semantics", but it is visible.
- **Persisted View All narrowing.** After View All, an edit made in the table persists
  `types:[X]` (today's behaviour), so the cards view then shows one section until Types are
  re-checked or Reset. The Types checkboxes are inline, so this is visible and recoverable.
- **Load fan-out.** Up to four `fetchActivities` calls run per filter change, against today's
  per-section calls, and each fans out server-side only for its single type. The shared client
  cache and the request-id guard bound this. A search debounce is not added, because the table
  has none.
- **Lifted state touches the table's focus and deep-link logic.** This is mitigated by the
  self-managed fallback that the existing deep-link tests exercise, and by step 2 landing with no
  test edits.
- **`useActivitiesCache` defaults.** Empty `types` defaults to excluding WORKFLOW_TASK
  (`useActivitiesCache.ts:103-106`). Sections always pass a single type, so the default never
  applies to them.
