# Scratchpad — Shared calendars

- Plan slug: `shared-calendars`
- Created: `2026-09-22`
- Card: `d837d8d2-5fd3-4e0b-a111-b78c7853573b`. Branch `feature/shared-calendars`, dev port 3394.

## Decisions

- (2026-09-22) **One model for both kinds of calendar.** The `calendars` table holds personal and group calendars. `calendar_shares` holds the access list, with a user or team as grantee. Personal calendars are virtual: entries reach them through `schedule_entry_assignees`. A personal `calendars` row exists only to hold shares, and is created the first time the owner shares. Group membership of an entry is stored in `schedule_entries.calendar_id`.
- (2026-09-22) **Team grants are resolved when access is checked**, not copied into per-user share rows. Adding or removing team members then needs no extra writes.
- (2026-09-22) **`user_schedule:update` keeps implicit view and edit of everyone** (G7). Dispatchers and managers depend on it today. Shares only add visibility for everyone else. Splitting out a real `read_all` permission is open question Q3 in the PRD.
- (2026-09-22) **Private entries are always Busy to non-assignees, including delegates and admins.** This matches the current masking in `scheduleActions.ts:170`. A private entry can't be placed on a group calendar.
- (2026-09-22) **No `created_by` or owner column on `schedule_entries`.** It isn't needed for these rules, and "own entry" stays "sole assignee". Deferred.
- (2026-09-22) **Visibility is filtered in SQL.** `ScheduleEntry.getAll` currently loads every entry in the tenant for the date range and filters in memory. With shares it gains an optional filter that runs before recurrence expansion.
- (2026-09-22) **Search index is out of scope.** `packages/search/src/indexers/schedule_entry.ts` sets `visibleToUserIds` to the assignees. Including share holders would mean re-indexing on every share change. Deferred.

## Discoveries / Constraints

- `schedule_entries` has had no `user_id` since `20241228003050`. Assignment lives only in `schedule_entry_assignees` (PK `(tenant, entry_id, user_id)`, cascade).
- `is_private` was added in `20250515104157`. Masking happens in `packages/scheduling/src/actions/scheduleActions.ts:170`: title becomes "Busy", notes are cleared, `work_item_type` becomes `ad_hoc`.
- `getScheduleEntryById` (`scheduleActions.ts:1157`) has **no `user_schedule:read` check**. Fixed by F015.
- Client code checks `user_schedule:read:all` (`packages/scheduling/src/hooks/useScheduleViewer.ts:7`, `ScheduleCalendar.tsx:340,362`). No migration seeds that permission and the server never checks it. In practice, seeing others' calendars requires `user_schedule:update`. Fixed by F030.
- The REST API has its own "view all" logic: `server/src/lib/api/controllers/ApiTimeSheetController.ts:1773–1955` (`canViewAllSchedules`), route `server/src/app/api/v1/schedules`.
- Schedule UI:
  - `ScheduleCalendar.tsx` holds `focusedTechnicianId` (:96), `comparisonTechnicianIds` (:97, not persisted) and `viewingTechnicianIds` (:365). Only entries of the focused user can be dragged (:886).
  - The picker is `TechnicianSidebar.tsx`. The editor is `EntryPopup.tsx`.
  - Events are colored by work item type (:206).
- The default view preference uses `useUserPreference('defaultScheduleView')`. The same mechanism works for the overlay selection. The model is `@alga-psa/db/models/userPreferences`.
- Teams: `teams` and `team_members` tables. `team_members.role` was added in `20260226171000`. Code is in `packages/teams` (`team-actions`).
- External sync (EE, `ee/packages/calendar`): `calendarSyncSubscriber.ts:77–90,187–222` only pushes to providers whose `user_id` is an assignee. Inbound events are assigned to the provider's user. Shared viewers therefore see synced entries through the assignee path with no extra work. `is_private` maps to Google `visibility` and Microsoft `sensitivity` (`eventMapping.ts:90,207`).
- Internal notifications currently only handle `APPOINTMENT_REQUEST_*` events (`server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts`). The template seeding pattern is in `20251111120002_add_appointments_internal_notifications.cjs`.
- Citus:
  - New tables must be distributed. Helper: `server/migrations/utils/citusDistribution.cjs`.
  - They must also be registered in `packages/db/src/lib/tenantTableMetadata.ts` and in `server/migrations/utils/tenantDb.cjs`.
  - Citus doesn't support `ON DELETE SET NULL`. When a group calendar is deleted, `schedule_entries.calendar_id` must be cleaned up in application code. Archiving instead of deleting avoids this.
- Grantee FKs can't be polymorphic (user or team). Cleanup on user or team deletion goes in the application delete paths (F026).
- Reusable UI components: `UserAndTeamPicker`, `MultiUserAndTeamPicker` and `ColorPicker` in `packages/ui/src/components`.
- i18n namespace: `server/public/locales/<locale>/msp/schedule.json`.

## Commands / Runbooks

- Create a migration: `cd server && npx knex migrate:make create_shared_calendars --knexfile knexfile.cjs --env migration`
- Validate the plan: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-09-22-shared-calendars`
- Dev server: port 3394 (compose project `alga-psa-local-test`).

## Links / References

- Schedule model: `shared/models/scheduleEntry.ts` (`getAll` :298, `update` :478, `updateAssignees` :109, recurrence :162–290)
- Actions: `packages/scheduling/src/actions/scheduleActions.ts`
- Page: `server/src/app/msp/schedule/page.tsx` → `packages/scheduling/src/components/schedule/SchedulePage.tsx`
- Profile calendar settings: `ee/packages/calendar/.../components/settings/profile/CalendarProfileSettings.tsx`
- RBAC seeds: `server/migrations/20250703193155_add_default_roles_and_permissions.cjs:421,448`, `20250430170700_add_dispatcher_role.cjs`

## Open Questions

Q1–Q5 are listed in the PRD. The most important are Q1 (whether group calendars are in v1) and Q2 (who may create group calendars).
