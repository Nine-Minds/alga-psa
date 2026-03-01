# Scratchpad — Teams V2: Org Hierarchy + Operational Teams

- Plan slug: `teams-v2`
- Created: `2026-02-26`

## Decisions

- (2026-02-26) Split current "teams" into two concepts: "Reports To" (org hierarchy) and "Teams" (functional/operational groups). Existing teams stay as operational groups.
- (2026-02-26) `reports_to` auto-seeded from existing team data. Safe because all active tenants with multi-team users have the same manager across teams. Atlas ICT (the only exception) canceled their subscription.
- (2026-02-26) Team assignment uses hybrid approach: `assigned_team_id` as metadata on ticket/task + expand members into `ticket_resources` for actual work assignment.
- (2026-02-26) New `UserAndTeamPicker` component (Option B) instead of modifying existing `UserPicker`. Swapped via feature flag at call site.
- (2026-02-26) Team removal dialog with radio/checkbox options: remove all, keep all, or individual selection.
- (2026-02-26) "Assigned To" filter enhanced to include teams (no separate team filter).
- (2026-02-26) "Reports To" UI placed in User Management (user edit form + org chart tab), not a separate Settings page.
- (2026-02-26) All UI elements gated behind `teams-v2` PostHog feature flag. Schema migrations are not gated.
- (2026-02-26) No team logos — just team name + generic team icon, following existing chip style.
- (2026-02-26) Team and individual agents are independent — adding/removing individual agents never triggers team removal.

## Discoveries / Constraints

- (2026-02-26) 40 teams in production across all tenants. Most users in exactly 1 team.
- (2026-02-26) `ticket_resources` has DB constraint `assigned_to != additional_user_id` — team lead must NOT be added as resource when they are the primary assignee.
- (2026-02-26) Deletion config at `packages/core/src/config/deletion/index.ts` already references `tickets.assigned_team_id` (column doesn't exist yet — will be created by our migration).
- (2026-02-26) `TicketProperties.tsx` has a commented-out team section — can be activated for team badge display.
- (2026-02-26) `projects.create_task` workflow action already supports `assignee.type = 'team'` — resolves manager_id. `tickets.create` does not.
- (2026-02-26) `isManagerOfSubject()` in `timeEntryDelegationAuth.ts` is the core approval check — joins teams → team_members.
- (2026-02-26) `fetchTimeSheetsForApproval()` in `timeSheetActions.ts` filters by `teams.manager_id = current_user`.
- (2026-02-26) Feature flags use `useFeatureFlag('flag-name')` hook from `packages/ui/src/hooks/useFeatureFlag.tsx`.
- (2026-02-26) `UserPicker` is at `packages/ui/src/components/UserPicker.tsx`, takes `value`, `onValueChange`, `users`, `size`, etc.
- (2026-02-26) Additional Agents use `MultiUserPicker` with chips: avatar + name + X button, `bg-gray-100 rounded-full` style.
- (2026-02-26) Ticket list filter uses `MultiUserPicker` with `filterMode={true}` and `selectedAssignees` state in `TicketingDashboard.tsx`.
- (2026-02-26) Several API endpoints in `TeamService.ts` reference non-existent tables and will crash: `team_hierarchy`, `team_permissions`, `project_team_assignments`, `task_assignments`.
- (2026-02-26) `getTeamAnalytics()` and `getTeamCapacity()` return hardcoded/mocked data.

## Commands / Runbooks

- Production query to check multi-team users:
  ```sql
  SELECT tenant, count(user_id) FROM team_members GROUP BY tenant, user_id HAVING count(team_id) > 1;
  ```
- Detailed multi-team query:
  ```sql
  WITH multi_team_users AS (
    SELECT tenant, user_id FROM team_members GROUP BY tenant, user_id HAVING count(team_id) > 1
  )
  SELECT t.company_name, tm.team_name, mgr.first_name || ' ' || mgr.last_name AS team_manager,
    u.first_name || ' ' || u.last_name AS member_name
  FROM team_members tmem
  JOIN teams tm ON tm.team_id = tmem.team_id AND tm.tenant = tmem.tenant
  JOIN users u ON u.user_id = tmem.user_id AND u.tenant = tmem.tenant
  JOIN tenants t ON t.tenant = tmem.tenant
  LEFT JOIN users mgr ON mgr.user_id = tm.manager_id AND mgr.tenant = tm.tenant
  JOIN multi_team_users mtu ON mtu.user_id = tmem.user_id AND mtu.tenant = tmem.tenant
  ORDER BY t.company_name, tm.team_name, u.last_name;
  ```

## Links / References

- Analysis document: `.ai/teams_improvements/teams_analysis_and_suggestions.md`
- Team model: `packages/teams/src/models/team.ts`
- Team actions: `packages/teams/src/actions/team-actions/teamActions.ts`
- Timesheet approval: `packages/scheduling/src/actions/timeSheetActions.ts`
- Delegation auth: `packages/scheduling/src/actions/timeEntryDelegationAuth.ts`
- TicketProperties (Agent team card): `packages/tickets/src/components/ticket/TicketProperties.tsx`
- Ticket resource actions: `packages/tickets/src/actions/ticketResourceActions.ts`
- UserPicker: `packages/ui/src/components/UserPicker.tsx`
- MultiUserPicker: `packages/ui/src/components/MultiUserPicker.tsx`
- Ticket list dashboard: `packages/tickets/src/components/TicketingDashboard.tsx`
- Feature flag hook: `packages/ui/src/hooks/useFeatureFlag.tsx`
- Deletion config: `packages/core/src/config/deletion/index.ts`
- Workflow projects action: `shared/workflow/runtime/actions/businessOperations/projects.ts`
- Workflow tickets action: `shared/workflow/runtime/actions/businessOperations/tickets.ts`
- Initial schema migration: `server/migrations/202409071803_initial_schema.cjs`

## Open Questions

- (None remaining — all questions resolved during analysis phase)

## Updates
- (2026-02-26) Added migration `server/migrations/20260226170000_add_reports_to_to_users.cjs` to create nullable `users.reports_to` with FK to `users.user_id`.
- (2026-02-26) Added migration `server/migrations/20260226170500_seed_reports_to_from_teams.cjs` to backfill `users.reports_to` from team membership and manager_id (skips self, respects existing values).
- (2026-02-26) Added server-side cycle prevention in `packages/users/src/actions/user-actions/userActions.ts` for `reports_to` updates (self-reference + recursive chain detection).
- (2026-02-26) Added optional `reports_to` to canonical IUser interfaces in `shared/interfaces/user.interfaces.ts` and `packages/types/src/interfaces/user.interfaces.ts`.
- (2026-02-26) Added Reports To dropdown to User Management details (`server/src/components/settings/general/UserDetails.tsx`) behind `teams-v2`, with tenant user list, clearable selection, and save wiring.
- (2026-02-26) Reports To selection now saved via `updateUser` when `teams-v2` is enabled (cycle validation enforced server-side).
- (2026-02-26) Reports To field rendering is gated behind `teams-v2` feature flag.
- (2026-02-26) Added Org Chart view to User Management (`server/src/components/settings/general/UserManagement.tsx`) using reports_to hierarchy; roots include users with null/missing reports_to and rendering is gated by `teams-v2`.
- (2026-02-26) Added `User.isInReportsToChain` in `packages/db/src/models/user.ts` using a recursive CTE and refactored reports_to cycle check to use it.
- (2026-02-26) Extended timesheet delegation auth to honor `reports_to` chain when `teams-v2` is enabled (using `User.isInReportsToChain`).
- (2026-02-26) `fetchTimeSheetsForApproval` now includes reports_to subordinates when `teams-v2` is enabled, using a recursive CTE for subordinate IDs.
- (2026-02-26) AvailabilitySettings now unions reports_to subordinates with team members when `teams-v2` is enabled.
- (2026-02-26) Added `getReportsToSubordinates` action and updated SchedulePage to grant availability access for reports_to managers when `teams-v2` is enabled.
- (2026-02-26) Added migrations for team member roles: `server/migrations/20260226171000_add_role_to_team_members.cjs` and backfill lead roles in `20260226171500_seed_team_member_leads.cjs`.
- (2026-02-26) Added `ITeamMember` type with `role` and updated team actions/model to return member roles and set lead role for managers.
- (2026-02-26) Added migrations for `assigned_team_id` on tickets and project_tasks: `server/migrations/20260226172000_add_assigned_team_id_to_tickets.cjs` and `20260226172500_add_assigned_team_id_to_project_tasks.cjs`.
- (2026-02-26) Added `assigned_team_id` to ITicket and IProjectTask interfaces.
- (2026-02-26) Added `assignTeamToTicket` and `assignTeamToProjectTask` actions to set assigned_team_id, set lead as primary if needed, and expand team members into resources with role `team_member`.
- (2026-02-26) Fixed plan test harness to resolve repo root via `__dirname` so file path assertions work regardless of working directory.
- (2026-02-26) Added `UserAndTeamPicker` component with grouped user/team sections for teams-v2 assignments.
- (2026-02-26) `UserAndTeamPicker` search now filters both users and teams together.
- (2026-02-26) Team options in `UserAndTeamPicker` now show member count and lead name.
- (2026-02-26) Added generic team icon rendering in `UserAndTeamPicker` (distinct from user avatars).
- (2026-02-26) Team selection in `UserAndTeamPicker` now triggers ticket/task team assignment actions.
- (2026-02-26) User selection flow in `UserAndTeamPicker` matches existing `UserPicker` behavior.
- (2026-02-26) Ticket detail "Assigned To" field now swaps to `UserAndTeamPicker` when `teams-v2` is enabled.
- (2026-02-26) Project task detail "Assigned To" field now swaps to `UserAndTeamPicker` under `teams-v2`.
- (2026-02-26) Preserved `UserPicker` rendering when `teams-v2` is disabled.
- (2026-02-26) Added team badge chip to the ticket "Agent team" card with icon, name, and remove affordance.
- (2026-02-26) Team badge rendering is gated behind the `teams-v2` feature flag.
- (2026-02-26) Team badge remove button now opens a confirmation dialog.
- (2026-02-26) Remove-all option clears `assigned_team_id` and deletes `team_member` ticket resources.
- (2026-02-26) Keep-all option clears only `assigned_team_id`, preserving existing ticket resources.
- (2026-02-26) Added selective team-member checkboxes in the removal dialog.
- (2026-02-26) Team removal actions preserve the primary `assigned_to` user.
- (2026-02-26) Team assignments are independent of individual agent add/remove flows.
- (2026-02-26) Team assignment resources are treated as a snapshot (no auto updates on roster changes).
- (2026-02-26) Ticket list "Assigned To" filter now includes teams when `teams-v2` is enabled.
- (2026-02-26) Team selections in the ticket list filter now map to `assigned_team_id`.
- (2026-02-26) Ticket list assignee filter reverts to user-only behavior when `teams-v2` is disabled.
- (2026-02-26) `tickets.create` workflow action now supports team assignee payloads and expands team members.
- (2026-02-26) Tenant export runbooks annotated to confirm `reports_to`, `assigned_team_id`, and `role` export coverage.
- (2026-02-26) Marked T002 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T003 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T004 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T005 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T006 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T007 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T008 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T009 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T010 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T011 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T012 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T013 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T014 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T015 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T016 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T017 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T018 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T019 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T020 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T021 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T022 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T023 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T024 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T025 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T026 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T027 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T028 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T029 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T030 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T031 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T032 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T033 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T034 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T035 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T036 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T037 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T038 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T039 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T040 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T041 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T042 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T043 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T044 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T045 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T046 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T047 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T048 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T049 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T050 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T051 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T052 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T053 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T054 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T055 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T056 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T057 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T058 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T059 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T060 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T061 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T062 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T063 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T064 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T065 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T066 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T067 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T068 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T069 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T070 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T071 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T072 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T073 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T074 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T075 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T076 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T077 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T078 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T079 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T080 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T081 test covered by teams-v2 plan suite.
- (2026-02-26) Marked T001 test covered by teams-v2 plan suite.
