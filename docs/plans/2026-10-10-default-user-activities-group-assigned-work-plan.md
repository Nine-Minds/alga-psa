# Default user-activities group for newly assigned work — implementation plan

Card: "alga0002045 follow-up: Default user-activities group for newly assigned work"
PSA ticket: alga0002045 · Branch: `feature/alga0002045-follow-up-default-user-activities-gr`
Sibling: "My group picker on detail screens" (not on `main` yet; see Coordination below).

## 1. What changes for the user

On the user-activities screen in Grouped view, a user can mark one of their groups as the default ("Inbox"). After that:

- Any activity on their board that is not explicitly in one of their groups appears in the default group instead of "Ungrouped". This covers new assignments of every type (tickets, project tasks, schedule entries, time entries, workflow tasks) and existing unfiled work.
- An activity the user explicitly moved into a group stays in that group.
- Unmarking the default, or deleting the default group, sends unfiled activities back to "Ungrouped".
- The setting is per user. Nothing on anyone else's board changes.

## 2. Decisions

### D1. The default is applied when the board renders (option A); no membership rows are written at assignment time

A per-user marker `user_activity_groups.is_default` (at most one per user) tells the renderers where to put activities that have no membership row. Nothing is written when work is assigned.

Why A and not B (write a membership row at assignment time):

- **Every assignment path is already covered.** Grouped view partitions the user's activity list (`fetchUserActivities…`), which is built from assignments. Anything assigned through any path (ticket UI, bulk assign, project tasks, schedule, time, workflow tasks, the v1 API, workflow automations, email, mobile) shows up in that list. Option B would need a hook in each of those paths, and any path added later without a hook would silently break the feature.
- **No writes to another user's private grouping.** A dispatcher assigning a ticket to Bob never touches Bob's `user_activity_group_items`. The cross-user write path (`resolveGroupOwnerForWrite` with `user_schedule:update`) stays reserved for explicit workflow actions.
- **It applies to existing work.** Setting a default immediately files all current unfiled work there. That matches the user's intent ("everything I haven't sorted lands here").
- **Changing the default stays cheap and consistent.** Changing or removing the default is a single-row update. Unfiled work follows the new default, and pinned work stays where it is.

The design session found no concrete need for B. B's only advantage is that items stay in the old default after the default changes. Explicit pins (D3) give the user that control.

### D2. With a default set, "Ungrouped" is hidden. Without one, nothing changes

With a default set, an activity has two possible states: pinned to a group (it has a row), or unpinned (it shows in the default group). A third "explicitly ungrouped" state would need a tombstone or opt-out row for each user and item, and it would be hard to explain in the UI. So:

- With a default group, the board does not render the Ungrouped section. Its collapse preference (`activitiesUngroupedCollapsed`) is kept but unused.
- "Remove from group" means "unpin" in every path: the `removeActivityFromGroups` action, REST `DELETE …/groups/items`, the workflow `activities.remove_from_group`, mobile, and the sibling picker's "None". The activity returns to the default group, or to Ungrouped when no default exists. The behaviour of the server functions does not change, only what the result looks like.
- Without a default group, rendering, drag-and-drop, and print are exactly as they are today.

### D3. Explicit placement always wins. Moving or reordering inside the default group pins

- Dragging an activity from group X into the default group calls `moveActivityToGroup` and writes a row in the default group. The activity is now pinned there and stays if the default later moves elsewhere. This is what "items I explicitly moved stay where I put them" requires.
- **Order inside the default group:** unpinned activities come first, in the server's default sort, so new arrivals sit at the top like an inbox. Pinned members follow in `sort_order`.
- **Reordering inside the default group** sends the full displayed order, as it does today. `reorderActivitiesInGroupForApi` currently only updates rows that already exist, so unpinned items would snap back. It changes to **upsert**: any listed activity without a row in that group gets one, after its membership in the owner's other groups is removed so an activity is never in two groups. The effect is that reordering inside the default group pins the reordered list. This is deliberate: the user arranged it. The change applies to every group, but for non-default groups every listed item already has a row, so behaviour there is the same as today.

### D4. Storage: a column on `user_activity_groups` plus a partial unique index

- `is_default boolean NOT NULL DEFAULT false`.
- `CREATE UNIQUE INDEX idx_user_activity_groups_one_default ON user_activity_groups (tenant, user_id) WHERE is_default`. The database enforces "at most one default per user". The index includes `tenant`, which is the Citus distribution column, so it works on a distributed table.
- I rejected two alternatives. A `default_group_id` in user preferences would be a second source of truth that can dangle after a delete. A `users` column would put feature data in a core table. The column is removed with the group row, which handles "deleting the default falls back to Ungrouped" without extra code.

### D5. Setting or clearing the default is an explicit action with its own core function

`setDefaultActivityGroupForApi(user, tenant, groupId | null)` in `activityGroupCore.ts` follows the existing identity-explicit core pattern, and a `withAuth` wrapper is exported from `activityGroupActions.ts`. It runs in one transaction: clear the caller's current default, then, if `groupId` is given, set it on that group with `user_id` scoping, and throw `Group not found` if the group is missing. It is gated by `assertCanOrganizeGroups`, the same check as the other own-group writes. Only the caller's own groups can be changed. In v1 there is no `targetUserId` and no cross-user setter, because nobody needs to set another user's inbox. If two set requests race, the partial unique index rejects one of them and the client reloads.

`updateActivityGroup` is not widened to carry `isDefault`. Setting a default touches two rows (old and new), which is a different invariant from patching one row, so it gets its own function.

### D6. Reads expose `isDefault`, and the partitioning logic moves into one shared helper

- `ActivityGroup` gains `isDefault: boolean`. `getUserActivityGroupsForApi` selects `is_default`, so web, `GET /api/v1/activities/groups`, and mobile all get it. The field is additive, so older mobile builds ignore it.
- The same "bucket activities into groups plus leftovers" logic exists in three places: `buildLocalGroups` in `GroupedActivitiesView.tsx`, the inline loop in `PrintableActivitiesView.tsx`, and `buildCustomGroups` in `ee/mobile/.../activityHelpers.ts`. Adding the default rule in three places would be the fourth copy. A pure helper `partitionActivitiesByGroup(activities, serverGroups)` will live in `packages/user-activities/src/lib/groupPartition.ts`. It has no server imports and is exported through the package's client-safe entry. It returns `{ groups: [{ group, activities, pinnedCount }], ungrouped: Activity[] }`, with the default rule and D3 ordering applied in one place. Web grouped view and print both use it.
- Mobile does not import `@alga-psa/*` packages (it is a separate Expo app), so `buildCustomGroups` gets the same rule as a mirror. It carries `// LEVERAGE: pattern activity-group-partition — mirrors packages/user-activities/src/lib/groupPartition.ts; mobile cannot import workspace packages` and its test reuses the same cases.

### D7. Viewing another user's board uses their default

`GroupedActivitiesView` in `readOnly` mode (`targetUserId`) receives the target user's groups, including their `isDefault`, so it shows their board as they see it. The default menu is hidden in read-only mode, in the same way rename and delete are today. A user's default only ever affects boards built from that user's groups.

### D8. Rules ("board X or priority Y goes to group Z") are out of v1

They are not trivial: they need a rule editor, an evaluation order, and i18n for criteria. The partition helper (D6) is the extension point for them. A later rule layer would sit there with precedence **explicit pin > first matching rule > default group > Ungrouped**, also applied at render time. That needs no change to assignment paths or the storage chosen here.

## 3. UI (Grouped view only, using standard components)

- **Group header menu:** add a `DropdownMenu` (`@alga-psa/ui/components/DropdownMenu`) behind a `MoreHorizontal` ghost `Button` in `GroupSection`'s header, next to the existing rename and delete buttons. The trigger id is `group-menu-${groupId}`. Items:
  - `set-default-group-${groupId}`: "Make default for new work". Shown when the group is not the default.
  - `unset-default-group-${groupId}`: "Stop using as default". Shown when it is the default.
  - Rename and delete stay as they are; moving them into the menu is a separate decision.
- **Default indicator:** a `Badge` (variant `secondary`) reading "Default" next to the group name. Its `title` and tooltip say "Activities you haven't placed in a group appear here, including newly assigned work."
- **Empty state of the default group:** "New work assigned to you will appear here". Other groups keep "Drop activities here".
- **Ungrouped section:** not rendered when `serverGroups.some(g => g.isDefault)`. `findContainer` and `handleDragEnd` keep working because unpinned activities are now in the default group's `activities`. A cross-container drop into the default group goes through `moveActivityToGroup` and pins the item (D3).
- **Error handling:** setting or unsetting is optimistic and calls `onGroupsChange()` to reload. On failure it reloads and shows a toast, like the other group mutations. The existing handlers only `console.error`; the new one uses the package's toast utility if one is used nearby, and otherwise matches the existing `console.error` + reload pattern. Do not add a third style.
- **Print:** `PrintableActivitiesView` uses the shared helper. The default group prints with its unpinned items. A collapsed default group's items are excluded from print, like any collapsed group. No Ungrouped table is printed when a default exists.
- **Mobile "My groups"** (read-only): the default group takes the unpinned activities, and there is no trailing "Ungrouped" bucket when a default exists. The mobile "Ungrouped" label is still hard-coded. Localizing it is out of scope; note it in the PR.

## 4. i18n

New keys in `server/public/locales/{en,fr,es,de,nl,it,pl,pt,sv}/msp/user-activities.json`, plus the `xx`/`yy` pseudo-locales, under `groupedView`:

```json
"defaultBadge": "Default",
"defaultBadgeHint": "Activities you haven't placed in a group appear here, including newly assigned work.",
"defaultGroupEmpty": "New work assigned to you will appear here",
"menu": {
  "setDefault": "Make default for new work",
  "unsetDefault": "Stop using as default"
},
"ariaLabels": { "groupMenu": "Group actions" },
"errors": { "setDefaultFailed": "Couldn't update the default group" }
```

Every `t()` call passes `defaultValue`, following the file's existing convention. Generate the pseudo-locales with the repo's existing pseudo-locale script if there is one; otherwise follow how the existing keys are represented in `xx`/`yy`.

## 5. Files to change

| File | Change |
|---|---|
| `server/migrations/<ts>_add_is_default_to_user_activity_groups.cjs` (new, via `npx knex migrate:make … --env migration`) | Add `is_default` column and partial unique index `(tenant, user_id) WHERE is_default`. `exports.config = { transaction: false }`, matching the parent migration. `down` drops the index and the column. |
| `packages/user-activities/src/actions/activityGroupCore.ts` | `ActivityGroup.isDefault`; select `is_default` in `getUserActivityGroupsForApi`; new `setDefaultActivityGroupForApi`; `reorderActivitiesInGroupForApi` upserts missing rows (D3) via `onConflict(['tenant','group_id','activity_id','activity_type']).merge(['sort_order'])` after removing those activities from the owner's other groups. |
| `packages/user-activities/src/actions/activityGroupActions.ts` | `setDefaultActivityGroup = withAuth(...)` plus `revalidatePath('/activities')`; `createActivityGroup` returns `isDefault: false`; update the `deleteActivityGroup` doc comment (deleting the default group falls back to Ungrouped). |
| `packages/user-activities/src/actions/index.ts` | Export `setDefaultActivityGroup`. |
| `packages/user-activities/src/server/activity-actions.ts` | Re-export `setDefaultActivityGroupForApi` next to the other core functions. |
| `packages/user-activities/src/lib/groupPartition.ts` (new) + export | Shared `partitionActivitiesByGroup` (D6). |
| `packages/user-activities/src/components/GroupedActivitiesView.tsx` | Replace `buildLocalGroups` with the helper; `LocalGroup.isDefault`; header `DropdownMenu`, badge, default empty state; hide `UngroupedSection` when a default exists; `handleSetDefault`/`handleUnsetDefault`. |
| `packages/user-activities/src/components/PrintableActivitiesView.tsx` | Use the helper; omit Ungrouped when a default exists. |
| `server/public/locales/*/msp/user-activities.json` | Keys from §4. |
| `ee/mobile/src/api/activities.ts` | `CustomActivityGroup.isDefault?: boolean`. |
| `ee/mobile/src/features/userActivities/activityHelpers.ts` (+ `.test.ts`) | Apply the default rule in `buildCustomGroups`; add a LEVERAGE marker. |
| `shared/workflow/runtime/actions/businessOperations/activities.ts` | No behaviour change. Update the `activities.remove_from_group` description: "returns it to the owner's default group, or Ungrouped". |

Not changed: ticket, project, schedule, time-entry, and workflow-task assignment code; bulk assign; v1 assignment endpoints; `user_activity_group_items` schema; `tenantTableMetadata.ts` and the migration shim (the table is already registered).

## 6. Tests

Contract tests (pattern `activityGroupActions*TenantScoped.contract.test.ts`; add `activityGroupActionsDefaultTenantScoped.contract.test.ts`):

1. `setDefaultActivityGroup(g1)` sets `is_default` on g1 only; `getUserActivityGroups` reports `isDefault`.
2. Setting g2 clears g1 (still at most one per user); `null` clears all.
3. Another user's group id gives `Group not found`, and that user's row is unchanged.
4. Deleting the default group leaves no default row for the user.
5. Missing `user_schedule:read` gives "Permission denied".
6. Reorder upsert: an unpinned activity in the ordered list gets a row; an activity listed while pinned in another group of the same owner moves (exactly one membership remains); existing rows get new `sort_order`.
7. Tenant scoping: queries are tenant-filtered, following the existing contract tests.

Unit tests for `groupPartition.ts`:

8. No default: unmembered activities go to `ungrouped` (same as today).
9. With a default: unmembered activities go to the default group first, then pinned ones; `ungrouped` is empty.
10. An item pinned in group X stays in X when another group is the default.
11. Items whose membership points at activities not in view are skipped (existing behaviour).

Mobile `activityHelpers.test.ts`: cases 8–10 mirrored.

Integration (`server/src/test/integration/api/userActivities.test.ts`):

12. `GET /api/v1/activities/groups` includes `isDefault`.
13. Migration: the partial unique index rejects a second `is_default = true` row for the same `(tenant, user_id)`.

Manual smoke on the dev server (`http://feature-alga0002045-follow-up-default-user-activities-gr.localhost:3424/msp/user-activities`, Grouped view). These map to the card's "Done when":

- Create "Inbox" and choose "Make default for new work". The badge appears, Ungrouped disappears, and existing unfiled items show in Inbox.
- As another user (or a dispatcher), assign a new ticket and a project task to me. They appear at the top of Inbox after refresh with no manual step.
- Drag one of them into "Waiting". It stays there after a reload and after changing the default to another group.
- "Stop using as default": unpinned items go back to Ungrouped, and items pinned in Inbox stay in Inbox.
- Delete the default group: its unpinned items go back to Ungrouped.
- Log in as a second user: their board has no default and still shows Ungrouped.
- Print the Grouped view with a default set: no Ungrouped table.

## 7. Coordination with the "My group picker on detail screens" sibling

- The picker should show the default group as "<name> (default)". "None/Remove" calls `removeActivityFromGroups`, which with a default set means "back to <default>". Label the option accordingly when a default exists, for example "Default (<name>)" instead of "None".
- The picker shows the item as being in the default group when it has no row and a default exists. Use `partitionActivitiesByGroup`, or a single-item variant `resolveActivityGroup(activityKey, groups)` exported from the same module, so the picker and the board cannot disagree.
- Whichever card merges second rebases onto the other. The `isDefault` field and the helper are the only shared contract.

## 8. Risks and notes

- **Retroactive sweep:** setting a default moves all unfiled work into it at once. This is intended and shows in the empty or Ungrouped state change, so no confirmation dialog is needed.
- **Reorder pins:** reordering inside the default group pins the listed items (D3). After that, changing the default leaves them behind. This is consistent with "explicit actions pin", and it is documented in the badge hint and the PR.
- **No backfill:** existing rows default to `false`, so behaviour after deploy is unchanged until a user opts in.
- **API consumers:** `isDefault` is an additive field, so there is no version bump.

## 9. Deployment order and manual apply

**The migration must run before the code is deployed.** `getUserActivityGroupsForApi` and any other query that selects `is_default` throws (`column "is_default" does not exist`) on a database that has not been migrated. We deliberately do not add runtime column detection or try/catch fallbacks, because they would hide schema drift.

The migration (`server/migrations/20261010040154_add_is_default_to_user_activity_groups.cjs`) is idempotent: `ADD COLUMN IF NOT EXISTS` plus `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_activity_groups_one_default ... WHERE is_default`. `down()` drops the index and the column with `IF EXISTS`.

### Manual apply on the shared dev database (`server`, compose project alga-psa-local-test, postgres :5472)

`knex migrate:up` refuses to run there because the shared database records migrations from other branches. An operator (not an agent) applies it by hand with the admin credentials from `server/.env.local` (`DB_USER_ADMIN` / `DB_PASSWORD_ADMIN`, `DB_HOST`, `DB_PORT`, `DB_NAME_SERVER`):

1. Run the module's `up()` through the knex library (not the CLI migrator), from `server/`:
   ```js
   const knex = require('knex')({ client: 'pg', connection: { host, port, database, user, password } }); // admin creds
   await require('./migrations/20261010040154_add_is_default_to_user_activity_groups.cjs').up(knex);
   ```
   Or run the two SQL statements directly:
   ```sql
   ALTER TABLE user_activity_groups ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
   CREATE UNIQUE INDEX IF NOT EXISTS idx_user_activity_groups_one_default ON user_activity_groups (tenant, user_id) WHERE is_default;
   ```
2. Record it so later `knex migrate` runs do not retry it (copy `batch` from the current max, or use max+1; check the table's columns first):
   ```sql
   INSERT INTO knex_migrations (name, batch, migration_time)
   VALUES ('20261010040154_add_is_default_to_user_activity_groups.cjs',
           (SELECT COALESCE(MAX(batch), 0) FROM knex_migrations), now());
   ```
3. Verify: `\d user_activity_groups` shows `is_default` and the partial unique index.
