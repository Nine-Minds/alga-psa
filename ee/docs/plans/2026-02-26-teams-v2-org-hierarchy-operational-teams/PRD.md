# PRD — Teams V2: Organizational Hierarchy + Operational Teams

- Slug: `teams-v2`
- Date: `2026-02-26`
- Status: Draft

## Summary

Split the existing single "teams" concept into two distinct structures:

1. **"Reports To" (Organizational Hierarchy)** — A `reports_to` field on each user forming a manager-subordinate tree. Drives org chart display, timesheet approval chains, and scheduling scope.
2. **"Teams" (Functional/Operational Groups)** — Repurpose existing teams as cross-functional groups that can be assigned to tickets and project tasks as a unit. Team lead auto-becomes primary assignee. Members are expanded into `ticket_resources`.

All new UI elements are gated behind a `teams-v2` PostHog feature flag. Schema migrations are additive and not gated.

## Problem

The current team system is a settings-only feature disconnected from day-to-day workflows:

- Teams cannot be assigned to tickets or tasks — work assignment is individual-only
- Timesheet approval is tightly coupled to team manager, but there's no formal org hierarchy — if a user's manager changes, you have to restructure teams
- There's no org chart visualization
- Manager-of-manager cannot approve subordinates' timesheets (no transitive authority)
- Several API endpoints reference non-existent database tables and crash at runtime

## Goals

1. Introduce a `reports_to` relationship on users to model organizational hierarchy
2. Auto-seed `reports_to` from existing team/manager data (zero customer effort)
3. Enable timesheet approval via the `reports_to` chain (transitive — manager of manager can approve)
4. Provide org chart visualization in User Management
5. Enable assigning an entire team to a ticket or project task
6. When a team is assigned, auto-set team lead as primary assignee and expand members into ticket resources
7. Provide a new `UserAndTeamPicker` component that shows both users and teams
8. Show team badge on the "Agent team" card in ticket detail
9. Enhance the "Assigned To" ticket list filter to include teams
10. Gate all new UI behind a feature flag for safe, gradual rollout

## Non-goals

- Team logos or custom team icons (use generic team icon only)
- Team-based reporting or analytics dashboards
- Team notifications on assignment
- Team-based dispatch filtering
- Workflow automation with team routing rules
- "My Team" ticket queue view
- Cleaning up broken API endpoints (deferred to Phase 3)
- Removing the existing team-manager approval path (kept for backwards compatibility)

## Users and Primary Flows

### Personas

- **MSP Admin** — Sets up org structure and teams. Manages user profiles.
- **Team Manager / Lead** — Approves timesheets for direct reports. Leads a functional team.
- **Technician / Agent** — Works on assigned tickets. May belong to one or more teams.

### Primary Flows

**Flow 1: Admin sets up "Reports To" hierarchy**
1. Admin opens User Management
2. Edits a user profile
3. Sets the "Reports To" dropdown to select their manager
4. Views the org chart tab to verify the hierarchy looks correct

**Flow 2: Manager approves timesheets via reporting chain**
1. Manager opens timesheet approval dashboard
2. Sees timesheets from all direct and indirect reports (via `reports_to` chain)
3. Approves or requests changes as usual

**Flow 3: Agent assigns a team to a ticket**
1. Agent opens a ticket
2. In the "Assigned To" field, the `UserAndTeamPicker` shows users and teams
3. Agent selects "Network Team"
4. System sets `assigned_team_id`, makes team lead the primary assignee (if empty), and adds all other members as additional agents
5. Team badge appears on the "Agent team" card

**Flow 4: Agent removes a team from a ticket**
1. Agent clicks "x" on the team badge
2. Confirmation dialog appears with options:
   - Remove all team members from assignment
   - Keep all team members as individual agents
   - Select individual members to keep/remove
3. Agent makes selection, `assigned_team_id` is cleared

**Flow 5: Filtering tickets by team**
1. Agent opens ticket list
2. Uses the "Assigned To" filter which now shows teams alongside users
3. Selects a team to see all tickets assigned to that team

## UX / UI Notes

### Reports To
- **"Reports To" dropdown** on the user edit form — standard dropdown selecting from all users in the tenant
- **Org chart tab** in User Management — tree view visualization of reporting lines (read-only)

### Team Assignment
- **`UserAndTeamPicker`** — new component replacing `UserPicker` via feature flag swap:
  ```tsx
  {featureFlag('teams-v2')
    ? <UserAndTeamPicker ... />
    : <UserPicker ... />}
  ```
  - Users section first, teams section below with separator
  - Teams show member count and lead name
  - Generic team icon for teams vs. user avatar for individuals

- **Team badge on "Agent team" card** — chip/badge following existing Additional Agents pattern (initials/icon + name + x button). Uses same chip styling as the existing `MultiUserPicker` chips (the `bg-gray-100 rounded-full` pill pattern).

- **Team removal dialog** — confirmation dialog with radio buttons:
  - "Remove all team members"
  - "Keep all team members as individual agents"
  - Individual checkboxes for each team member

- **"Assigned To" filter enhancement** — existing `MultiUserPicker` filter in `TicketingDashboard.tsx` enhanced to show teams in the dropdown alongside users when flag is on.

- **All new UI must follow established component variants, color schemes, and interaction patterns.**

## Requirements

### Functional Requirements

#### Phase 1: Reports To + Org Hierarchy

- FR-1.1: Add nullable `reports_to UUID` column to `users` table referencing `users(user_id)`
- FR-1.2: Auto-seed `reports_to` from existing team membership data in the migration (team member → team manager_id)
- FR-1.3: Validate that setting `reports_to` doesn't create circular chains
- FR-1.4: Add "Reports To" dropdown field on user edit form (behind feature flag)
- FR-1.5: Build org chart tree view in User Management (behind feature flag)
- FR-1.6: Add `isInReportsToChain()` function for transitive approval check
- FR-1.7: Extend `canApprove` logic: existing team-manager check (always active) + `reports_to` chain check (behind feature flag)
- FR-1.8: Update `fetchTimeSheetsForApproval()` to include timesheets from `reports_to` subordinates when flag is on
- FR-1.9: Update AvailabilitySettings to additionally scope by `reports_to` when flag is on
- FR-1.10: Update SchedulePage to additionally scope by `reports_to` when flag is on

#### Phase 2: Operational Teams

- FR-2.1: Add `role TEXT DEFAULT 'member'` column to `team_members` table
- FR-2.2: Migration: set `role = 'lead'` for existing team members whose `user_id` matches `teams.manager_id`
- FR-2.3: Add nullable `assigned_team_id UUID` column to `tickets` table referencing `teams(team_id)`
- FR-2.4: Add nullable `assigned_team_id UUID` column to `project_tasks` table referencing `teams(team_id)`
- FR-2.5: Implement team assignment action: sets `assigned_team_id`, assigns lead as primary (if `assigned_to` is NULL), expands other members into `ticket_resources` with `role = 'team_member'`
- FR-2.6: When assigning team and `assigned_to` is already set: add all team members as resources EXCEPT whoever is already `assigned_to`
- FR-2.7: Team lead must NOT be added as `ticket_resources` when they are the primary assignee (DB constraint: `assigned_to != additional_user_id`)
- FR-2.8: Build `UserAndTeamPicker` component showing users and teams in grouped sections (behind feature flag)
- FR-2.9: Feature flag swap: render `UserAndTeamPicker` instead of `UserPicker` on ticket/task detail when `teams-v2` is enabled
- FR-2.10: Show team badge (chip: generic icon + team name + x) on "Agent team" card when `assigned_team_id` is set (behind feature flag)
- FR-2.11: Clicking "x" on team badge shows confirmation dialog with removal options
- FR-2.12: "Remove all" option removes `ticket_resources` with `role = 'team_member'` and clears `assigned_team_id`
- FR-2.13: "Keep all" option clears `assigned_team_id` only, resources stay
- FR-2.14: Individual selection option lets user choose which team members to keep/remove
- FR-2.15: Primary `assigned_to` is never automatically removed when clearing team assignment
- FR-2.16: Adding/removing individual agents does NOT affect team assignment. Team badge and individual agent chips coexist independently.
- FR-2.17: Team membership is a snapshot at assignment time — later team roster changes don't affect existing ticket resources
- FR-2.18: Enhance "Assigned To" filter in ticket list to show teams alongside users when flag is on
- FR-2.19: Selecting a team in the filter → filters by `tickets.assigned_team_id`
- FR-2.20: Extend `tickets.create` workflow action to support `assignee: { type: 'team', id: uuid }` (matching `projects.create_task` pattern)
- FR-2.21: Update `ITicket` and `IProjectTask` interfaces to include `assigned_team_id`
- FR-2.22: Update tenant export to include new columns (`reports_to`, `assigned_team_id`, `role`)

### Non-functional Requirements

- NFR-1: All new UI elements gated behind `teams-v2` PostHog feature flag
- NFR-2: Schema migrations are additive (nullable columns) and not feature-flag-gated
- NFR-3: Existing team-manager timesheet approval logic remains active and unchanged
- NFR-4: Multi-tenant isolation preserved — all queries tenant-scoped
- NFR-5: `isInReportsToChain()` must handle arbitrarily deep hierarchies without stack overflow (use iterative/CTE approach)

## Data / API / Integrations

### Schema Changes

```sql
-- Phase 1
ALTER TABLE users ADD COLUMN reports_to UUID REFERENCES users(user_id);

-- Auto-seed
UPDATE users u SET reports_to = t.manager_id
FROM team_members tm
JOIN teams t ON t.team_id = tm.team_id AND t.tenant = tm.tenant
WHERE u.user_id = tm.user_id AND u.tenant = tm.tenant AND u.user_id != t.manager_id;

-- Phase 2
ALTER TABLE team_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
UPDATE team_members tm SET role = 'lead'
FROM teams t WHERE tm.team_id = t.team_id AND tm.tenant = t.tenant AND tm.user_id = t.manager_id;

ALTER TABLE tickets ADD COLUMN assigned_team_id UUID REFERENCES teams(team_id);
ALTER TABLE project_tasks ADD COLUMN assigned_team_id UUID REFERENCES teams(team_id);
```

### Affected Interfaces

- `IUser` — add `reports_to?: string`
- `ITeam` — existing, no change needed (manager_id stays as team lead reference)
- `ITeamMember` — add `role: 'member' | 'lead'`
- `ITicket` — add `assigned_team_id?: string`
- `IProjectTask` — add `assigned_team_id?: string`
- `ITicketResource` — `role` field will use `'team_member'` value for team-assigned resources

### API Considerations

- Existing team CRUD endpoints unchanged
- New server actions needed: `assignTeamToTicket()`, `removeTeamFromTicket()`, `getReportsToChain()`
- Existing `addTicketResource()` reused for individual member expansion

## Security / Permissions

- `reports_to` changes: require user edit permission
- Team assignment on tickets: require ticket edit permission (same as changing `assigned_to`)
- Timesheet approval via `reports_to`: require `timesheet:approve` permission (existing)
- Cycle prevention on `reports_to`: server-side validation, not client-only
- All queries continue to be tenant-scoped via RLS policies

## Rollout / Migration

### Migration Safety

- All schema changes are additive nullable columns — no data loss, no breaking changes
- `reports_to` auto-seeded in migration from existing team data (verified safe for all active tenants)
- All UI behind feature flag — invisible until enabled
- Existing approval logic untouched — works in parallel

### Rollout Plan

1. Deploy migrations (schema + data seed) — invisible to users
2. Enable `teams-v2` flag on staging for internal testing
3. Enable flag on Nine Minds tenant for dogfooding
4. Gradual per-tenant rollout to customers
5. Once stable, remove flag gates and make generally available

## Open Questions

None — all questions resolved during analysis phase.

## Acceptance Criteria (Definition of Done)

1. `reports_to` column exists on users and is auto-seeded from existing team data
2. Setting `reports_to` rejects circular chains
3. Org chart view displays the reporting hierarchy correctly
4. Managers can approve timesheets for direct and indirect reports via `reports_to` chain
5. A team can be assigned to a ticket, setting team lead as primary and expanding members into resources
6. Team badge appears on "Agent team" card with working "x" removal
7. Team removal dialog offers all three options and executes correctly
8. `UserAndTeamPicker` shows users and teams, swaps correctly via feature flag
9. "Assigned To" filter includes teams when flag is on
10. All new UI is invisible when `teams-v2` flag is off
11. Existing team-manager approval continues to work unchanged
12. No regressions in existing ticket assignment, resource management, or timesheet approval
