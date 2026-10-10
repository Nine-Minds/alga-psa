# Plan: set my user-activities group from ticket and project task detail screens

PSA ticket: alga0002045
Branch: `feature/alga0002045-set-my-user-activities-group-from-ti`
Base: `main` @ `b0d0b4dacf`

## 1. Problem

Today the only way to change which personal group an activity sits in is drag-and-drop in the
grouped list on `/msp/user-activities` (`GroupedActivitiesView.tsx`). When I am working a ticket
or project task, I can't see which of my groups it is in, can't change that group, and can't
jump to the item on the board.

This change adds:

1. A **"My group" control** on the ticket detail screen and the project task detail screens.
   It shows the current group, lets me move the record to another group, clear the group, or
   create a new group inline. It includes a deep link to the item on the board.
2. A **"Move to group" submenu** in `ActivityActionMenu`, so every activity type can be grouped
   without dragging.
3. A **deep link**: `/msp/user-activities?activity=<type>:<id>` opens the grouped list,
   scrolls to the item, and highlights it.

## 2. What exists (verified against the current code)

| Concern | Location | Notes |
|---|---|---|
| Schema | `server/migrations/20260410120000_create_user_activity_groups.cjs` | `user_activity_groups` (per tenant+user), `user_activity_group_items` (activity_id, activity_type → group_id, sort_order). No FK to the activity. |
| Core logic | `packages/user-activities/src/actions/activityGroupCore.ts` | `getUserActivityGroupsForApi`, `moveActivityToGroupForApi` (removes any prior membership, shifts sort orders, inserts), `removeActivityFromGroupsForApi`, `reorderActivitiesInGroupForApi`. Writes are gated by `user_schedule:read` for own groups. |
| Server actions | `packages/user-activities/src/actions/activityGroupActions.ts` | `withAuth` wrappers: `getUserActivityGroups`, `createActivityGroup`, `moveActivityToGroup`, `removeActivityFromGroups`, etc. They call `revalidatePath('/activities')`, which is not the board's route (`/msp/user-activities`). This is harmless because the board holds its state on the client. Not in scope. |
| Board | `ActivitiesDataTableSection.tsx` → `GroupedActivitiesView.tsx` | The section owns `activityGroups` state and loads it with `getUserActivityGroups(targetUserId)` only in grouped mode. Grouped mode loads **all** activities (page 1, size 500), so a deep-linked item is never on another page. Rows are keyed `${type}:${id}`. Viewing another user (`targetUserId`) makes the grouped view `readOnly`. |
| Dashboard | `UserActivitiesDashboard.tsx` | Already reads `?focus=notifications` and switches the view for this visit only (`ephemeralView`), without saving the preference. The new deep-link param follows the same pattern. |
| "On my list" rule | `activityAggregationActions.ts` `fetchTicketActivities` (≈L1004) / `fetchProjectActivities` (≈L723) | The record is on my list if `assigned_to = me`, or a `ticket_resources` / `task_resources` row has `assigned_to = me` or `additional_user_id = me`. Closed records are hidden only by the default filter (`isClosed: false`), so they are still list members. |
| Cross-feature context | `packages/ui/src/context/ActivityCrossFeatureContext.tsx` | Has render callbacks (`renderTicketDetails`, `renderTaskEdit`, …) and optional EE members (`dismissTask`, …). `useActivityCrossFeature()` **throws** without a provider. |
| Provider mount | `packages/msp-composition/src/workflows/MspActivityCrossFeatureProvider.tsx`, mounted in `server/src/components/layout/WorkspaceProviders.tsx` | Mounted across the MSP workspace, so it covers `/msp/tickets/[id]`, `/msp/projects/[id]`, and every drawer. **Not mounted on AlgaDesk** (`WorkspaceProviders` passes children straight through there). |
| Ticket UI | `packages/tickets/src/components/ticket/TicketInfo.tsx` (title block ≈L1235, shared field grid starts ≈L1335) | Has `ticket.assigned_to` and `additionalAgents` props. Assignment edits stay pending until "Save changes". |
| Project task UI | `packages/projects/src/components/TaskForm.tsx` (title row ≈L1733, `mode==='edit'`), wrapped by `TaskEdit.tsx` | Has `task.assigned_to` and the `taskResources` state. |
| Read-only task UI | `packages/scheduling/src/components/shared/SchedulingProjectTaskDetails.tsx`, used only by `technician-dispatch/WorkItemDetailsDrawer.tsx` | The record includes `task_id`. |
| Action menu | `ActivityActionMenu.tsx` | Rendered from `ActivitiesDataTable`, `GroupedActivitiesView`, `ActivityCard`, `NotificationCard`. |
| UI primitives | `packages/ui/src/components/DropdownMenu.tsx` | Exports `DropdownMenuSub` (the bare Radix root) but **no styled `SubTrigger` / `SubContent` / `RadioItem`**. `CustomSelect` supports `allowClear`, `onAddNew`, and `addNewLabel`. |
| i18n | `ROUTE_NAMESPACES` in `packages/core/src/lib/i18n/config.ts` | `/msp/tickets` and `/msp/projects` don't preload `msp/user-activities`. |

## 3. Design decisions

### D1. The control is a render callback in the cross-feature context, owned by `user-activities`

Add one optional member to `ActivityCrossFeatureCallbacks`:

```ts
export interface ActivityGroupControlRenderProps {
  id: string;                                   // DOM id prefix (automation ids)
  activityId: string;
  activityType: 'ticket' | 'projectTask';       // ActivityType.TICKET | ActivityType.PROJECT_TASK
  /** Changes whenever the record's saved assignment changes; re-runs the eligibility check. */
  assignmentKey: string;
}
renderActivityGroupControl?: (props: ActivityGroupControlRenderProps) => ReactNode;
```

`MspActivityCrossFeatureProvider` implements this member by rendering `ActivityGroupControl`
from `@alga-psa/user-activities`. `msp-composition` already depends on that package.

Why a render callback instead of threading `getGroups`, `move`, `clear`, and `create` through
as four data callbacks (the `dismissTask` style):

- The picker, the eligibility rule, and the group state all belong to `user-activities`. With
  data callbacks, `tickets`, `projects`, and `scheduling` would each rebuild the same picker
  and the same eligibility handling: the same code in three hosts.
- The context already uses render callbacks for the reverse direction (`renderTicketDetails`,
  `renderTaskEdit`). Hosts only decide **where** the control goes, not how it works.
- There is still no new package dependency: `tickets`, `projects`, and `scheduling` import only
  `@alga-psa/ui/context`.

Add `useOptionalActivityCrossFeature(): ActivityCrossFeatureCallbacks | null` to the same
context file. Hosts must use it, because AlgaDesk mounts no provider and
`useActivityCrossFeature()` would throw there. On AlgaDesk, or wherever the member is absent,
the control simply doesn't render.

### D2. Show the control only when the record is on my list, decided on the server from the same rule the board uses

New core function `isActivityOnUsersListForApi(user, tenant, activityType, activityId)` plus
a `withAuth` action `isActivityOnMyList(activityType, activityId)`:

- `ticket`: `tickets.assigned_to = me`, or EXISTS a `ticket_resources` row with
  `assigned_to = me OR additional_user_id = me`.
- `projectTask`: the same rule against `project_tasks` / `task_resources`.
- Any other type returns `false`. The detail-screen control is v1-scoped to these two.
- Returns `false` (no error) when the caller lacks `user_schedule:read`, because they couldn't
  organize groups anyway.
- Closed records still count as on the list. The board shows them when the closed filter is
  off, and membership should survive while a ticket is closed.

**Single source of truth:** move the two `where(...)` blocks out of `fetchTicketActivities`
and `fetchProjectActivities` into a new module,
`packages/user-activities/src/actions/activityAssignmentScope.ts`, exporting
`whereTicketOnUsersList(scopedDb, db, userId)` and `whereProjectTaskOnUsersList(...)` as knex
`where` builders. Both the aggregator and the eligibility check use them, so "appears on my
board" and "can be grouped from the detail screen" can't drift apart. Without this, the rule
would exist a second time in a different file, and the third copy would come with the
schedule-entry follow-up.

The check runs on mount and whenever `assignmentKey` changes. Hosts build the key from
**saved** assignment state, so the control appears or disappears as soon as an assignment is
saved, not while it is still pending:

- Ticket: `${ticket.assigned_to ?? ''}|${sortedAdditionalAgentIds.join(',')}`.
- Task: `${task.assigned_to ?? ''}|${sortedTaskResourceUserIds.join(',')}`.

The existing mutations (`moveActivityToGroup` etc.) **don't** get an eligibility guard.
Drag-and-drop and the action menu only act on items already on the list. Workflow actions file
items into other users' groups on purpose, possibly before assignment
(`resolveGroupOwnerForWrite`), and a guard in the core would break that. The UI gate addresses
the orphan-row concern where such rows would actually be created.

### D3. One client-side store for my groups, mounted for the whole workspace

New `MyActivityGroupsProvider` + `useMyActivityGroups()` in
`packages/user-activities/src/components/MyActivityGroupsProvider.tsx`, mounted by
`MspActivityCrossFeatureProvider` around its children:

```ts
interface MyActivityGroupsStore {
  groups: ActivityGroup[] | null;          // null until first load
  status: 'idle' | 'loading' | 'ready' | 'error';
  ensureLoaded(): Promise<void>;           // lazy; first consumer triggers load
  refresh(): Promise<void>;
  groupOf(type: string, id: string): ActivityGroup | null;
  moveTo(type: string, id: string, groupId: string): Promise<void>;   // appends: sortOrder = target.items.length
  clear(type: string, id: string): Promise<void>;                     // removeActivityFromGroups
  createAndMove(name: string, type: string, id: string): Promise<void>; // createActivityGroup → moveTo
}
```

- Updates are optimistic: local state changes first, then the server action runs. On failure
  the change is rolled back and a toast is shown (`handleError` / existing toast utility).
- Nothing loads until a consumer calls `ensureLoaded()`, so pages that never show the control
  pay nothing.
- `ActivitiesDataTableSection` **uses the store when viewing myself**
  (`activityGroups = viewingOther ? otherUserGroups : store.groups`, and
  `loadActivityGroups = viewingOther ? fetchOther : store.refresh`). It keeps its current direct
  fetch only for the read-only "viewing another user" case. This is what makes "the board
  reflects it immediately" true. A change made in a ticket drawer opened over the board, or
  from the action menu, updates the same state the grouped view renders, with no refetch race.
  The board still calls `refresh()` on mount, so changes from other tabs show up.
- `GroupedActivitiesView` drag-and-drop doesn't change. It keeps calling the actions and then
  `onGroupsChange()`, which is now `store.refresh()` for myself.

### D4. Make it clear the control is personal, not a ticket field

- It sits **in the header area**, under the title row, outside and above the shared field grid.
  It never appears inside `grid grid-cols-2`. On project tasks it sits on the task-name label
  row (right side). In the dispatch drawer it sits under the heading.
- It is a **chip** with a bookmark icon (`lucide-react` `Bookmark` outline when ungrouped,
  `BookmarkCheck` when grouped):
  - Ungrouped: "My group: Ungrouped"
  - Grouped: "My group: {{name}}".
  - In both states the chip is followed by an icon link (`ArrowUpRight`), "Show on my
    activities", that points to the deep link. The board shows ungrouped items too, so the link
    is useful either way.
- Clicking the chip opens a `Popover` (`@alga-psa/ui/components/Popover`) containing:
  - A heading, "My group", with the hint "Only you can see this. It organizes your activities
    list." This tells the user directly that colleagues won't see the value.
  - `CustomSelect`: options are my groups in sort order; value is the current group id;
    `allowClear` maps to `clear()`, so a cleared value means "Ungrouped"; `onAddNew` with
    `addNewLabel = "New group…"` switches to an inline `Input` + confirm/cancel `Button`s, the
    same interaction as the board toolbar, and confirming calls `createAndMove`.
  - The deep link.
- Standard components only. The chip itself is a `Button variant="ghost" size="sm"` with
  rounded-full styling. No new picker primitive.
- Automation ids: `${id}-my-group-chip`, `${id}-my-group-select`,
  `${id}-my-group-new-name`, `${id}-my-group-create`, `${id}-my-group-link`.

### D5. Action menu gets a "Move to group" submenu for every activity type

- Add styled `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, and `DropdownMenuRadioItem` to
  `packages/ui/src/components/DropdownMenu.tsx`. They are missing today, and a hand-styled
  Radix sub-menu inside `user-activities` would work around the primitive layer instead of
  extending it.
- The submenu appears in `ActivityActionMenu` after the ad-hoc items and before
  `activity.actions`. It has a radio group of my groups (current one checked) plus an
  "Ungrouped" item, which calls `clear`, then a separator, then "New group…". "New group…"
  opens a small `Dialog` with an `Input`. A text field inside a dropdown loses focus to the
  menu's typeahead, so it gets its own dialog.
- On open it calls `store.ensureLoaded()`. While loading it shows a disabled "Loading…" item.
- It is gated by a new tiny context in `user-activities`,
  `ActivityGroupMenuScope` (`{ enabled: boolean }`, default `true`). `ActivitiesDataTableSection`
  provides `enabled = !viewingOther`. When a dispatcher is viewing someone else's list, filing
  that person's items into the dispatcher's **own** groups would create orphans and confuse
  the "whose groups am I looking at" model. Decision 6 also puts acting on behalf of others out
  of scope.
- It covers every activity type, including ad-hoc schedule items, time entries, workflow
  tasks, and notifications, because each one is a `{type, id}` row in the grouped view. The
  submenu has no type special-casing.
- After a change it calls `onActionComplete?.()`, keeping the current menu contract.

### D6. Deep link: `/msp/user-activities?activity=<type>:<id>`

- The param name is `activity` (not `focus`), because `focus=notifications` already has a
  meaning. The value uses the same `${type}:${id}` key the grouped view uses for rows.
- A shared builder, `buildActivityBoardHref(type, id)`, lives in
  `packages/user-activities/src/lib/activityBoardLink.ts`. Only the control uses it inside
  `user-activities`. Hosts never build the URL.
- `UserActivitiesDashboard`: when `activity` is present, set the table view for this visit only
  (the same mechanism as `focusNotifications`; the saved preference isn't written) and pass
  `focusActivityKey` to `ActivitiesDataTableSection`.
- `ActivitiesDataTableSection` with `focusActivityKey`:
  - Forces `targetUserId = ''` (myself) and grouped list mode **for this visit only**. Add an
    `ephemeralListViewMode` override next to the saved `listViewMode`. The saved preference
    isn't written.
  - Passes `focusActivityKey` to `GroupedActivitiesView`.
- `GroupedActivitiesView` with `focusActivityKey`:
  - Every `SortableActivityRow` / ungrouped row gets `data-activity-key="${type}:${id}"`.
  - Once activities and groups have loaded: if the containing group is collapsed, expand it
    **locally only** (no `updateActivityGroup` write, so the saved collapse state stays as it
    was). Do the same for the ungrouped section if it is collapsed. Then
    `scrollIntoView({ block: 'center', behavior: 'smooth' })` and apply a highlight (a ring in
    `--color-primary-500` plus background tint) that fades after about 3 seconds. Use inline
    style or `data-highlighted` CSS, since the file notes that not all of its Tailwind classes
    are scanned.
  - The param is consumed once: after highlighting, call `router.replace` on the same path
    without `activity`, so a refresh or the back button doesn't highlight again.
  - **Not found** (filtered out by saved filters such as type or closed, or no longer on my
    list): show an inline `Alert` above the list, "This item isn't in your current view.", with
    a "Clear filters" button. The button applies, for this visit only, a filter with all table
    types and no `isClosed` restriction, then retries the focus. If the item still isn't
    found, the alert changes to "This item is no longer on your activities list."

### D7. Reassignment: **keep** group membership (explicit decision)

When a record leaves my list (unassigned, or reassigned to someone else), its
`user_activity_group_items` row is **kept**. If it is later reassigned to me, it comes back in
its old group.

Reasons:
- Membership is my private bookkeeping. If a colleague's action (reassigning a ticket) deleted
  it, someone else's change would destroy part of my personal organization, which contradicts
  D4's promise that the control is personal and unaffected by others.
- Stale rows are invisible. `buildLocalGroups` only renders items that are in the current
  activity set, so a membership for a record that isn't on my list doesn't appear anywhere.
  The detail control is hidden in that state too (D2).
- Clearing would require hooks in every assignment path: ticket save, ticket resources, task
  save, task resources, workflow actions, bulk reassign, and the REST API. That couples
  `tickets` and `projects` to `user-activities` write semantics. Records deleted outright
  already leave orphan rows today, so keeping them on reassignment adds no new class of data.
- Volume: one small row per (user, activity) at most, enforced by the "one group per user per
  activity" rule in `moveActivityToGroupForApi`.

This decision is recorded in a short doc comment on `isActivityOnUsersListForApi` and in the
`activityGroupCore.ts` header. A future "prune memberships for records not on the list" job can
be added if row volume ever matters. It isn't needed for correctness.

### D8. Privacy and multiple users

All new reads and writes are scoped to the session user (`withAuth` → `user.user_id`). No
`targetUserId` is exposed through the new action or the control. When user B opens a ticket I
grouped, B's eligibility check and B's store are evaluated for B, so B sees either nothing or
B's own grouping.

### D9. i18n

- All new strings go in `msp/user-activities` (`server/public/locales/*/msp/user-activities.json`),
  under a new `myGroup` key (control) and `actionMenu.moveToGroup` / `deepLink` keys.
- Add `'msp/user-activities'` to `ROUTE_NAMESPACES['/msp/tickets']`, `['/msp/projects']`, and
  `['/msp/technician-dispatch']` so the strings are preloaded on the detail routes. The en file
  is about 17 KB. Drawers opened from other routes fall back to lazy loading.
- Add translations for de, es, fr, it, nl, pl, pt, and sv, regenerate the pseudo-locales
  (`node scripts/generate-pseudo-locales.cjs`), and run `node scripts/validate-translations.cjs`.

Keys (en):

```json
"myGroup": {
  "label": "My group",
  "chip": "My group: {{name}}",
  "ungrouped": "Ungrouped",
  "privacyHint": "Only you can see this. It organizes your activities list.",
  "selectPlaceholder": "Choose a group",
  "newGroup": "New group…",
  "newGroupPlaceholder": "Group name",
  "create": "Create",
  "showOnBoard": "Show on my activities",
  "errors": { "move": "Couldn't change your group. Try again.", "create": "Couldn't create the group. Try again.", "load": "Couldn't load your groups." }
},
"actionMenu": { "moveToGroup": "Move to group", "loadingGroups": "Loading…", "newGroupTitle": "New group" },
"deepLink": {
  "notInView": "This item isn't in your current view.",
  "clearFilters": "Clear filters",
  "notOnList": "This item is no longer on your activities list."
}
```

## 4. Files to change

### New
| File | Purpose |
|---|---|
| `packages/user-activities/src/actions/activityAssignmentScope.ts` | Shared "on user's list" knex predicates for tickets and project tasks (D2). |
| `packages/user-activities/src/components/MyActivityGroupsProvider.tsx` | Workspace-wide store + `useMyActivityGroups()` (D3). |
| `packages/user-activities/src/components/ActivityGroupControl.tsx` | "My group" chip + popover (D4). |
| `packages/user-activities/src/components/ActivityGroupMenuScope.tsx` | `{enabled}` context for the action-menu submenu (D5). |
| `packages/user-activities/src/components/MoveToGroupSubmenu.tsx` | The submenu + new-group dialog used by `ActivityActionMenu` (D5). |
| `packages/user-activities/src/lib/activityBoardLink.ts` | `buildActivityBoardHref` / `parseActivityKey` (D6). |
| Tests (see §6) | |

### Modified
| File | Change |
|---|---|
| `packages/ui/src/context/ActivityCrossFeatureContext.tsx` | `ActivityGroupControlRenderProps`, optional `renderActivityGroupControl`, `useOptionalActivityCrossFeature()`. |
| `packages/ui/src/components/DropdownMenu.tsx` | Styled `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, `DropdownMenuRadioItem`. |
| `packages/user-activities/src/actions/activityGroupCore.ts` | `isActivityOnUsersListForApi`; header note on the keep-on-reassign decision (D7). |
| `packages/user-activities/src/actions/activityGroupActions.ts` | `isActivityOnMyList` `withAuth` action. |
| `packages/user-activities/src/actions/activityAggregationActions.ts` | Use the shared predicates in `fetchTicketActivities` and `fetchProjectActivities`. Behavior stays the same. |
| `packages/user-activities/src/components/index.ts` (+ `package.json` exports if a subpath is needed) | Export `MyActivityGroupsProvider` and `ActivityGroupControl`. |
| `packages/user-activities/src/components/ActivityActionMenu.tsx` | Render `MoveToGroupSubmenu` when the scope is enabled. |
| `packages/user-activities/src/components/ActivitiesDataTableSection.tsx` | Use the store when viewing myself; `ActivityGroupMenuScope`; `focusActivityKey` handling (grouped mode and self for this visit only, not-found alert, clear-filters retry). |
| `packages/user-activities/src/components/GroupedActivitiesView.tsx` | `data-activity-key` on rows; `focusActivityKey` expand → scroll → highlight → consume param. |
| `packages/user-activities/src/components/UserActivitiesDashboard.tsx` | Read `?activity=`, force the table view for this visit, pass `focusActivityKey`. |
| `packages/msp-composition/src/workflows/MspActivityCrossFeatureProvider.tsx` | Mount `MyActivityGroupsProvider`; implement `renderActivityGroupControl`. |
| `packages/tickets/src/components/ticket/TicketInfo.tsx` | Render the control under the title row (outside the field grid) via `useOptionalActivityCrossFeature()`. `assignmentKey` comes from `ticket.assigned_to` + `additionalAgents`. |
| `packages/projects/src/components/TaskForm.tsx` | Render the control on the task-name label row when `mode==='edit' && task?.task_id`. `assignmentKey` comes from `task.assigned_to` + `taskResources`. `TaskEdit.tsx` needs no change. |
| `packages/scheduling/src/components/shared/SchedulingProjectTaskDetails.tsx` | Render the control under the heading. `assignmentKey` is `task.assigned_to ?? ''` (the record already carries `assigned_to`). |
| `packages/core/src/lib/i18n/config.ts` | Add the `msp/user-activities` namespace to the tickets, projects, and technician-dispatch routes. |
| `server/public/locales/*/msp/user-activities.json` | New keys (all locales + pseudo). |
| `server/src/test/unit/layout/WorkspaceProviders.static.test.ts` | Update only if it asserts the provider tree shape. |

No migration. No change to `moveActivityToGroup`, `removeActivityFromGroups`, or
`createActivityGroup` semantics.

## 5. Implementation order

1. Shared predicates in `activityAssignmentScope.ts` + refactor the aggregator. The existing
   aggregation contract tests must stay green.
2. `isActivityOnUsersListForApi` + `isActivityOnMyList` + contract tests.
3. UI primitives: DropdownMenu sub/radio items; context member + optional hook.
4. `MyActivityGroupsProvider` + unit tests; wire it into `ActivitiesDataTableSection` for
   myself.
5. `ActivityGroupControl` + `activityBoardLink`; implement `renderActivityGroupControl` in
   msp-composition.
6. Host placement: TicketInfo, TaskForm, SchedulingProjectTaskDetails.
7. Action-menu submenu + scope.
8. Deep link: dashboard → section → grouped view.
9. i18n: keys, all locales, pseudo-locales, validation, route namespaces.
10. Browser verification on the dev server (`http://feature-alga0002045-set-my-user-activities-group-from-ti.localhost:3837`) with two users.

## 6. Tests

**Contract / integration** (follow the `activityGroupActions*TenantScoped.contract.test.ts` pattern):
- `isActivityOnUsersListForApi`:
  - Ticket: primary assignee → true; `ticket_resources.additional_user_id` → true;
    `ticket_resources.assigned_to` → true; unrelated user → false; another tenant's ticket id
    → false; closed ticket assigned to me → true.
  - Project task: the same matrix against `task_resources`.
  - Unknown type → false; no `user_schedule:read` → false.
- Aggregator regression: the existing ticket and project assignment contract tests pass
  unchanged after the predicate extraction.

**Unit** (vitest + RTL):
- `MyActivityGroupsProvider`: lazy load; `moveTo` updates optimistically and appends at the end;
  rollback + toast on rejection; `clear`; `createAndMove`; `groupOf`.
- `ActivityGroupControl`:
  - Renders nothing while the eligibility check is pending or false.
  - Shows "Ungrouped" / the group name.
  - Selecting a group calls `moveTo`; clearing calls `clear`; inline create calls
    `createAndMove`.
  - Re-checks eligibility when `assignmentKey` changes.
  - The link href equals `buildActivityBoardHref`.
- Hosts: `TicketInfo` / `TaskForm` / `SchedulingProjectTaskDetails` render no control (and
  don't throw) without a provider, which is the AlgaDesk case, and call
  `renderActivityGroupControl` with the right `activityType` / `activityId` when it is present.
- `ActivityActionMenu`: the submenu lists groups with the current one checked; selecting calls
  `moveTo`; "Ungrouped" calls `clear`; the submenu is hidden when `ActivityGroupMenuScope`
  disables it; it renders for every `ActivityType`.
- `GroupedActivitiesView` / section deep link: grouped mode and myself are forced without
  writing preferences; a collapsed group is expanded locally without calling
  `updateActivityGroup`; `scrollIntoView` is called on the matching row; the param is removed;
  the not-found alert appears and "Clear filters" retries.
- `activityBoardLink`: build/parse round trip, including ids with no special characters and
  an invalid key.

**Browser verification** (dev server, two internal users A and B):
1. A opens a ticket assigned to A: the chip shows "My group: Ungrouped". A picks group X, and
   the board (opened in the same session) shows the ticket in X right away. Clearing it moves
   the ticket back to Ungrouped. Creating group "Y" inline moves the ticket into Y.
2. The same on a project task where A is an additional agent.
3. A opens a ticket not assigned to A: no chip. A assigns it to themselves and saves: the chip
   appears.
4. The link opens `/msp/user-activities`, grouped, scrolled to the item with the highlight; the
   saved view preference is unchanged afterwards.
5. A uses "Move to group" from the action menu on a schedule entry, a ticket, a project task,
   and an ad-hoc item.
6. B opens the ticket A grouped: B sees no chip (not assigned), or B's own Ungrouped chip if B
   is an additional agent. A's grouping is unchanged after B acts.
7. Unassign A, then reassign A: the ticket reappears in its previous group (D7).
8. Switch the locale to `xx`: every new string shows pseudo text.

## 7. Out of scope / follow-ups

- Time entries and schedule entries as detail-screen hosts (card decision 3). The action-menu
  submenu still covers them on the board.
- Setting someone else's group (sibling "default group" card).
- Server-side pruning of stale memberships (see D7).
- `revalidatePath('/activities')` in `activityGroupActions.ts` targets a route that doesn't
  exist. It is harmless and left alone, and noted here for whoever touches that file next.
