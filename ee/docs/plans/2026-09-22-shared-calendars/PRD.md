# PRD — Shared calendars

- Slug: `shared-calendars`
- Date: `2026-09-22`
- Status: Draft. Scope decisions below still need confirmation (see Open Questions).
- Card: `d837d8d2-5fd3-4e0b-a111-b78c7853573b`

## Summary

MSP employees can share calendars with each other in two ways:

1. **Share my calendar.** An employee grants other users or teams access to their personal schedule. The levels are **Free/busy**, **View details** and **Edit**.
2. **Group calendars.** Named calendars that belong to the MSP rather than to one person, for example "On-call rotation", "Office closures" or "Maintenance windows". An entry can be placed on a group calendar. Members see or edit the calendar according to the level they were granted.

One access resolver decides what a viewer may see and change. The schedule page, entry lookups and the REST schedules API all go through it.

## Problem

Seeing someone else's schedule currently depends on a single role permission:

- A user with `user_schedule:update` (dispatchers, managers) sees and edits every entry in the tenant.
- Everyone else sees only entries they are assigned to.

Nothing sits between those two. A technician can't let a colleague see their week. A team can't see its own members' availability. An account manager can't let an assistant book time for them. Events that belong to a group rather than a person have no home. Today they are ad-hoc entries assigned to one person, or to everyone.

Some existing inconsistencies make this worse:

- The client checks a `user_schedule:read:all` permission that is never seeded and never checked on the server.
- `getScheduleEntryById` does not check `user_schedule:read` at all.
- The multi-user "Compare" selection on the schedule page resets on every visit.

## Goals

- G1. An employee can share their personal calendar with specific users and teams at a chosen level, and can change or revoke each share.
- G2. A recipient sees shared calendars on the schedule page as overlays they can toggle, and the selection is remembered.
- G3. Free/busy recipients see only "Busy" blocks. View-details recipients see full entries, except private entries, which always appear as "Busy".
- G4. An edit recipient can create entries for the calendar owner and move, edit or delete the owner's non-private entries, like a delegate.
- G5. Any MSP user can create a group calendar, give members access (Free/busy, View details, Edit, Manage), place entries on it and overlay it on the schedule page.
- G6. All read paths enforce visibility on the server through one resolver: the calendar list, entry detail and REST `/api/v1/schedules`.
- G7. Existing behaviour stays the same for users with `user_schedule:update` and for assignees.

## Non-goals

- Sharing with people outside the MSP, such as client portal contacts or public links.
- Syncing group calendars to Google or Microsoft as separate external calendars. Entries on a group calendar still sync to their assignees' connected calendars, as today.
- Importing shared calendars from Google or Microsoft.
- Letting search results include entries visible only through a share. The search index keeps its assignee-only visibility.
- REST endpoints for managing calendars and shares. The v1 API only honours shares when reading schedules.
- Changing the technician dispatch dashboard, which stays gated by `technician_dispatch`.
- Showing delegates private entries. Private entries are always "Busy" to non-assignees.
- Recording who created an entry. The "own entry" rule stays based on assignees.

## Users and Primary Flows

Personas:

- **Technician or engineer.** Shares a calendar with a teammate or team and looks at colleagues' availability.
- **Service manager or team lead.** Receives team calendars and may hold `user_schedule:update` already.
- **Assistant or coordinator (delegate).** Books time on someone else's calendar using an Edit share.
- **Office admin.** Owns group calendars such as closures and on-call.

Flow 1: Share my calendar
1. On the Schedule page, the user opens **Share my calendar**. The same dialog is available from Profile, Calendar settings.
2. They add users or teams with `UserAndTeamPicker` and pick a level (Free/busy, View details or Edit).
3. They save. Each user recipient gets an internal notification: "{{owner}} shared their calendar with you".
4. Later, the owner changes a level or removes a recipient in the same dialog. The change applies to the recipient's next load.

Flow 2: View shared calendars
1. The Schedule sidebar has a **Calendars** section with three groups: *My calendar*, *People* and *Group calendars*.
2. *People* lists only calendars the viewer can see: shared with them directly or through a team, or every internal user if they hold `user_schedule:update`.
3. Checkbox toggles overlay the calendars. Each calendar has a stable color. The selection is saved as a user preference.
4. Free/busy entries and masked private entries show as "Busy" blocks. Opening one shows a read-only popup with only the time and "Busy".

Flow 3: Delegate editing
1. With an Edit share from user A, user B turns on A's calendar and creates an entry with A as the default assignee.
2. B can drag, resize and edit A's non-private entries. The assignee picker only offers users whose calendars B can edit, plus B.
3. Private entries of A's stay read-only "Busy" for B.

Flow 4: Group calendars
1. **New group calendar** asks for a name, color, optional description and members with levels. The creator becomes a Manage member.
2. In the entry popup, a **Calendar** field defaults to *Personal*. It lists the group calendars the user has Edit or Manage on. Choosing a group calendar hides the Private toggle, because group entries are never private.
3. Assignees are optional on group calendar entries. Assigned users also see the entry on their personal calendar.
4. Managers can rename, recolor, change members or archive the calendar. Archiving hides the calendar and its entries from every view without deleting them. Only managers see and can restore archived calendars.

## UX / UI Notes

- Route: `/msp/schedule` (`packages/scheduling/src/components/schedule/SchedulePage.tsx`, `ScheduleCalendar.tsx`, `TechnicianSidebar.tsx`).
- The sidebar keeps the current focus-and-compare model:
  - **Focus** means "whose calendar new entries default to". It can be self or any calendar the viewer can edit.
  - **Overlay** means read-only, or editable when the viewer has Edit.
  - Group calendars are overlay-only. Focus stays a person.
- Color: overlays use the calendar's color as a left stripe or border. The work-item-type fill colors stay. Group calendars store a color. People calendars get a deterministic color per user.
- Dialogs follow the Dialog standards in `docs/AI_coding_standards.md`. Use existing UI primitives: `UserAndTeamPicker`, `ColorPicker`, `CustomSelect` and `DataTable`.
- All new strings go in the `msp/schedule` namespace (`server/public/locales/*/msp/schedule.json`) for every supported locale.
- Busy blocks: the title is the translated "Busy". There is no work-item link, notes or assignee list.

## Requirements

### Functional Requirements

**Access levels**
- Personal calendar: `free_busy` < `read` < `edit`.
- Group calendar: `free_busy` < `read` < `edit` < `manage`.
- When a user holds several grants, one direct and some through teams, the highest level wins.

**Visibility of an entry for a viewer**, evaluated in order:
1. The viewer is an assignee: full access (existing rules).
2. The entry is on a group calendar and the viewer's level on it is at least `read`: full. At `free_busy` it is Busy.
3. Otherwise, take the viewer's best level over the personal calendars of the entry's assignees:
   - `read` or `edit`: full, except private entries, which are Busy.
   - `free_busy`: Busy.
4. The viewer holds `user_schedule:update`: treat every personal calendar as `edit`, which is today's behaviour. Private entries stay Busy.
5. Otherwise the entry is not returned.

Unassigned, pending appointment-request entries keep today's rule: visible to `user_schedule:update` holders.

**Modify, move and delete**
- Allowed when the viewer is an assignee (today's rule), or has `edit` on any assignee's personal calendar, or has `edit` or higher on the entry's group calendar, or holds `user_schedule:update`.
- Private entries can only be changed by their sole assignee (unchanged).

**Assign**
- Without `user_schedule:update`, a viewer can only set assignees they have `edit` on, plus themselves.
- On create, the default assignee is the focused calendar's owner.

**Shares and calendars**
- A group calendar needs at least one `manage` member while it isn't archived. Removing or downgrading the last manager is rejected.
- `user_schedule:update` holders can manage every group calendar, including ones whose managers have left.
- Team grants are resolved at read time. Adding someone to a team gives them access, and removing them takes it away, with no extra writes.
- Deleting a user or team removes their shares (cascade). Shares held by or granted by inactive users are ignored when resolving access.
- A user can't share their calendar with themselves. Sharing with the same user or team twice updates the level (upsert).
- A private entry can't be placed on a group calendar. Setting a calendar clears `is_private`. The server enforces this.
- Recurring entries: expanded virtual instances inherit the parent entry's calendar, assignees and visibility.
- External calendar sync sends group-calendar entries only to their assignees' connected providers. Group entries with no assignees never sync externally.
- Provider-side edits apply to Alga only when the provider's user has `canEdit` under `evaluateEntryAccess`; otherwise Alga remains authoritative and its version is pushed back to that provider.
- Provider-side deletes delete the Alga entry only when that user could delete it in Alga and is its sole assignee. Otherwise only that user's assignment and provider mapping are removed.
- Removing a read-only sole assignee may leave the entry with no assignees. This is intentional for group and personal entries; group entries with no assignees remain in Alga and never sync externally.
- Archiving a group calendar removes its assignees' external copies and mappings through schedule-entry update events. Restoring it recreates those copies. Inbound provider changes are ignored while archived.

**Capabilities**
- The server returns viewer capabilities to the client (`canViewAll`, the list of visible calendars with their levels). This replaces the client-side `user_schedule:read:all` check.
- `getScheduleEntryById` and REST `GET /api/v1/schedules` (list and by id) apply the same resolver.

### Non-functional Requirements

- Visibility is filtered in SQL before recurrence expansion. The query restricts to entries whose assignee is in the viewer's visible user set or whose `calendar_id` is in their visible calendar set. The current load-everything-then-filter-in-memory path is not kept for non-admins.
- Access resolution for one request is at most a constant number of queries: shares for the viewer, the viewer's teams, and group calendars. It must not issue one query per entry.
- All tables are tenant-scoped, distributed on Citus by `tenant` and registered in `tenantTableMetadata` and the migration shim.

## Data / API / Integrations

New tables (`server/migrations`, CE):

- **`calendars`**
  - Columns:
    - Identity and type: `tenant`, `calendar_id uuid`, `calendar_type text check in ('personal','group')`, `owner_user_id uuid null`.
    - Display: `name text null`, `description text null`, `color text null`, `is_archived boolean default false`.
    - Audit: `created_by uuid`, `created_at`, `updated_at`.
  - PK `(tenant, calendar_id)`.
  - Partial unique index `(tenant, owner_user_id) where calendar_type='personal'`. A check constraint requires `owner_user_id` for personal calendars and `name` for group calendars.
  - Personal rows are created lazily the first time a user shares. They exist only to hold shares. Entries reach a personal calendar through their assignees.
- **`calendar_shares`**
  - Columns: `tenant`, `share_id uuid`, `calendar_id`, `grantee_type text check in ('user','team')`, `grantee_id uuid`, `access_level text check in ('free_busy','read','edit','manage')`, `created_by`, `created_at`, `updated_at`.
  - PK `(tenant, share_id)`. Unique `(tenant, calendar_id, grantee_type, grantee_id)`.
  - FK to `calendars` with cascade. `manage` is only valid on group calendars; the server validates this.
  - Grantee FKs can't be polymorphic, so cleanup when a user or team is deleted is done in application code in the user and team delete paths.
- **`schedule_entries.calendar_id uuid null`**: a composite FK `(tenant, calendar_id)` to `calendars`, indexed on `(tenant, calendar_id)`. It only ever points at group calendars.

Code:

- `packages/scheduling/src/lib/calendarAccess.ts`: the resolver.
  - `resolveCalendarAccess(db, viewer)` returns the visible user IDs with levels, the visible group calendars with levels, and `canViewAll`.
  - `evaluateEntryAccess(entry, access)` returns `full`, `busy` or `none`, plus `canEdit`.
  - `maskEntry(entry)`.
- Model: `shared/models/scheduleEntry.ts`. `getAll` gains an optional visibility filter `{ userIds, calendarIds, includeUnassignedAppointmentRequests }`. `create` and `update` persist `calendar_id`.
- Actions:
  - New `packages/scheduling/src/actions/calendarSharingActions.ts`: `getMyCalendarShares`, `setMyCalendarShares`, `getCalendarsVisibleToMe`, `createGroupCalendar`, `updateGroupCalendar`, `setGroupCalendarShares`, `archiveGroupCalendar`, `restoreGroupCalendar`.
  - `scheduleActions.ts`: `getScheduleEntries`, `getScheduleEntryById`, `addScheduleEntry`, `updateScheduleEntry` and `deleteScheduleEntry` switch to the resolver.
- Types in `packages/types/src/interfaces/schedule.interfaces.ts`:
  - New `ICalendar`, `ICalendarShare`, `CalendarAccessLevel`.
  - `IScheduleEntry` gains `calendar_id?`, `access?: 'full' | 'busy'` and `can_edit?`.
- Events: `CALENDAR_SHARE_GRANTED` in `packages/event-schemas`. `internalNotificationSubscriber` creates the notification for user grantees. A migration seeds the internal notification template.
- REST: `ApiTimeSheetController` schedule handlers replace `canViewAllSchedules` with the resolver.

## Security / Permissions

- Base gate: every sharing action requires an authenticated MSP (internal) user with `user_schedule:read`. Client-portal users can't be grantees. The picker is limited to internal users, and the server validates this.
- Reuse the existing `user_schedule` resource. No new RBAC resource is added (see Open Questions, Q2).
- Only the owner, or a `user_schedule:update` holder, can change shares on a personal calendar. Only `manage` members, or `user_schedule:update` holders, can change a group calendar.
- Masking happens on the server. Busy entries never carry title, notes, work item or assignee details to the client.

## Observability

No new observability beyond existing logging. Not requested.

## Rollout / Migration

- The migration is additive: two tables and a nullable column. No backfill.
- No feature flag. Without shares or group calendars, behaviour matches today. The first-run UI shows empty *People* and *Group calendars* groups with a "Share my calendar" or "New group calendar" call to action.
- The EE calendar sync package applies the inbound access rules above. Entries with a `calendar_id` still sync by assignee.

## Open Questions

- Q1. Is including group calendars in v1 right, or should v1 be personal sharing only? The draft includes both because the data model is shared and the card says "shared calendars".
- Q2. Who may create group calendars? The draft allows any MSP user with `user_schedule:read`. The alternative is a new `shared_calendar:create` permission or `user_schedule:update` only.
- Q3. Should `user_schedule:update` keep implicit "view and edit everyone"? The draft keeps it so managers and dispatchers see no change. The alternative is to split it into a real `user_schedule:read_all`.
- Q4. Should the notification cover team grants too (every team member) or only direct user grants? The draft notifies direct user grants only.
- Q5. Can a delegate with Edit also share the owner's calendar onward? The draft says no. Only the owner, or admins, manage shares on a personal calendar.

## Acceptance Criteria (Definition of Done)

- A user shares their calendar with a user (View details) and a team (Free/busy):
  - The user recipient sees full entries, with private entries as Busy.
  - Team members see only Busy blocks.
  - Removing a member from the team removes their access.
- A user with an Edit share creates an entry on the owner's calendar and moves an existing one. With a View details share, both are rejected on the server.
- A group calendar with read and edit members:
  - Edit members create entries.
  - Read members only view.
  - Archiving hides the calendar and its entries for everyone except managers.
- `getScheduleEntryById` and REST `/api/v1/schedules` never return an entry, or an unmasked entry, the viewer isn't entitled to.
- Overlay selection on the schedule page persists across reloads.
- Users with `user_schedule:update` see and edit exactly what they could before.
- The DB-backed integration tests and the E2E journey in `tests.json` pass.
