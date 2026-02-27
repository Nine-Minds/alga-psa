# Teams V2

The Teams V2 feature adds comprehensive team management capabilities to Alga PSA: team member roles, team avatars, team assignment to tickets/tasks/templates, board-level default teams, organizational hierarchy with reports-to chains, and an org chart visualization. All UI is gated behind the **`teams-v2`** PostHog feature flag.

## Core Features

### Team Member Roles

Each team member has a `role` field: `'member'` or `'lead'`.

- Team managers are automatically assigned the `'lead'` role
- New members added via `addUserToTeam` default to `'member'`
- `assignManagerToTeam` ensures the manager is also a team member with `'lead'` role

### Team Avatars

Teams can have avatar images, reusing the existing `document_associations` / `EntityImageService` pattern.

- **Upload**: `uploadTeamAvatar(teamId, formData)` — stores image via `uploadEntityImage('team', ...)`
- **Delete**: `deleteTeamAvatar(teamId)` — removes via `deleteEntityImage('team', ...)`
- **Single fetch**: `getTeamAvatarUrlAction(teamId, tenant)` — returns URL or null
- **Batch fetch**: `getTeamAvatarUrlsBatchAction(teamIds[], tenant)` — returns `Map<string, string | null>`, queries `document_associations` where `entity_type='team'` and `is_entity_logo=true`
- **Component**: `TeamAvatar` (`packages/ui/src/components/TeamAvatar.tsx`) — wraps `EntityAvatar`, shows colored initials as fallback
- **Hook**: `useTeamAvatar` (`packages/teams/src/hooks/useTeamAvatar.ts`) — SWR-cached client-side fetching with `refreshAvatar()` and `invalidateTeamAvatar()`

### Team Assignment to Tickets

When a team is assigned to a ticket:

1. `ticket.assigned_team_id` is set
2. The team lead becomes the primary assignee (`assigned_to`) if none exists
3. Remaining team members are added as `ticket_resources` with `role='team_member'`
4. Duplicate resources are skipped

**Removal** supports three modes via `removeTeamFromTicket(ticketId, { mode, keepUserIds? })`:
- `'remove_all'` — removes all team member resources
- `'keep_all'` — only clears `assigned_team_id`, keeps resources
- `'selective'` — removes all except specified `keepUserIds`

**Filtering**: `ITicketListFilters.assignedTeamIds` enables filtering ticket lists by team. The optimized ticket query joins the `teams` table and supports combined user + team + unassigned filtering with OR logic.

### Team Assignment to Project Tasks

Same pattern as tickets: `assigned_team_id` column on `project_tasks` with a foreign key to `teams`. Task forms use `UserAndTeamPicker` for primary agent and `MultiUserAndTeamPicker` for additional agents. Team selection through either picker sets the `assigned_team_id` and populates members.

### Team Assignment to Project Templates

`assigned_team_id` column on `project_template_tasks`. When a template is applied to create a project, the team assignment is optionally copied based on `copyOptions.copyAssignments`.

Relevant template actions:
- `createTemplateFromWizard` — inserts tasks with `assigned_team_id`
- `updateTemplateFromEditor` — preserves `assigned_team_id` on updates
- `saveTemplateAsNew` — copies `assigned_team_id` from source tasks

### Board Default Team

Boards can have a `default_assigned_team_id`. When a ticket is created on that board (via QuickAddTicket), the team is pre-selected. Configured in Settings > Boards via `UserAndTeamPicker`.

### Organizational Hierarchy (Reports-To)

A `reports_to` column on the `users` table establishes manager relationships independent of team structure. Used for:
- Org chart visualization
- Time entry delegation authorization
- Time sheet approval chains
- Scheduling and availability

Configured per-user in User Details settings (only visible when `teams-v2` flag is enabled).

### Org Chart Visualization

A ReactFlow-based interactive org chart in Settings > User Management:
- Top-down tree layout from `reports_to` relationships
- Custom nodes showing avatar, name, role, and inactive badge
- Click a node to open User Details drawer
- Batch-fetches user avatars
- Supports zoom and pan

### Client Portal Display

The client portal displays team information in read-only mode:
- **Ticket list**: Team avatar badges in the assigned-to column
- **Ticket details**: Team avatar and name alongside the assignee
- **Project Kanban/list views**: Team badges on task cards

---

## Database Schema

### Migrations

| Migration | Table | Change |
|---|---|---|
| `20260226170000_add_reports_to_to_users` | `users` | Add `reports_to` UUID column (FK to `users.user_id`) |
| `20260226170500_seed_reports_to_from_teams` | `users` | Seed `reports_to` from `team_members` → `teams.manager_id` |
| `20260226171000_add_role_to_team_members` | `team_members` | Add `role` TEXT column (default `'member'`) |
| `20260226171500_seed_team_member_leads` | `team_members` | Set `role='lead'` where `user_id = team.manager_id` |
| `20260226172000_add_assigned_team_id_to_tickets` | `tickets` | Add `assigned_team_id` UUID (FK to `teams.team_id`). No transaction (Citus). |
| `20260226172500_add_assigned_team_id_to_project_tasks` | `project_tasks` | Add `assigned_team_id` UUID (FK to `teams.team_id`) |
| `20260227000001_add_team_to_document_associations_entity_type` | `document_associations` | Add `'team'` to `entity_type` CHECK constraint. No transaction. |
| `20260227100000_add_assigned_team_id_to_project_template_tasks` | `project_template_tasks` | Add `assigned_team_id` UUID (FK to `teams.team_id`) |
| `20260227200000_add_default_assigned_team_id_to_boards` | `boards` | Add `default_assigned_team_id` UUID (FK to `teams.team_id`). No transaction. |

All foreign keys use composite `(tenant, id)` pattern for Citus compatibility.

### Key Relationships

```
teams
  ├── team_members (team_id, user_id, role)
  ├── tickets.assigned_team_id
  ├── project_tasks.assigned_team_id
  ├── project_template_tasks.assigned_team_id
  ├── boards.default_assigned_team_id
  └── document_associations (entity_type='team', is_entity_logo=true)

users
  └── reports_to → users.user_id
```

---

## Server Actions API

### Team CRUD — `packages/teams/src/actions/team-actions/teamActions.ts`

| Function | Parameters | Returns | Permission |
|---|---|---|---|
| `createTeam` | `teamData` (with optional `members[]`) | `ITeam` | `user_settings` / `create` |
| `updateTeam` | `teamId`, `Partial<ITeam>` | `ITeam` | `user_settings` / `update` |
| `deleteTeam` | `teamId` | `DeletionValidationResult` | `user_settings` / `delete` |
| `getTeamById` | `teamId` | `ITeam` (with members) | `user_settings` / `read` |
| `getTeams` | — | `ITeam[]` (with members) | `user_settings` / `read` |
| `addUserToTeam` | `teamId`, `userId` | `ITeam` | `user_settings` / `update` |
| `removeUserFromTeam` | `teamId`, `userId` | `ITeam` | `user_settings` / `update` |
| `assignManagerToTeam` | `teamId`, `userId` | `ITeam` | `user_settings` / `update` |

### Avatar Actions — `packages/teams/src/actions/team-actions/avatarActions.ts`

| Function | Parameters | Returns | Permission |
|---|---|---|---|
| `uploadTeamAvatar` | `teamId`, `FormData` | `{ success, avatarUrl? }` | `user_settings` / `update` |
| `deleteTeamAvatar` | `teamId` | `{ success }` | `user_settings` / `update` |
| `getTeamAvatarUrlAction` | `teamId`, `tenant` | `string \| null` | None |
| `getTeamAvatarUrlsBatchAction` | `teamIds[]`, `tenant` | `Map<string, string \| null>` | None |

### Ticket Team Assignment — `packages/tickets/src/actions/teamAssignmentActions.ts`

| Function | Parameters | Returns | Permission |
|---|---|---|---|
| `assignTeamToTicket` | `ticketId`, `teamId` | `void` | `ticket` / `update` |
| `removeTeamFromTicket` | `ticketId`, `{ mode, keepUserIds? }` | `void` | `ticket` / `update` |

---

## UI Components

### UserAndTeamPicker

**File**: `packages/ui/src/components/UserAndTeamPicker.tsx`

Single-select picker for choosing a user or a team. Shows team member count and lead name. Fetches avatars in batch when the dropdown opens.

**Key props**: `value`, `onValueChange`, `onTeamSelect`, `users`, `teams`, `getUserAvatarUrlsBatch`, `getTeamAvatarUrlsBatch`

**Used in**: TaskForm (primary agent), TemplateTaskForm (primary agent), TicketInfo (assignee), QuickAddTicket (assignee), BoardsSettings (default team), TemplateTasksStep (wizard)

### MultiUserAndTeamPicker

**File**: `packages/ui/src/components/MultiUserAndTeamPicker.tsx`

Multi-select picker for users and teams. Supports filter mode with "Unassigned" option, compact display, and checkbox-based selection. Teams appear in a separate section.

**Key props**: `values`, `onValuesChange`, `teams`, `teamValues`, `onTeamValuesChange`, `filterMode`, `compactDisplay`

**Used in**: TaskForm (additional agents), TemplateTaskForm (additional agents), TicketProperties (additional agents), TicketingDashboard (assignee filter)

### TeamAvatar

**File**: `packages/ui/src/components/TeamAvatar.tsx`

Display component wrapping `EntityAvatar`. Shows the team's uploaded avatar image or colored initials as fallback. Supports sizes: `xs`, `sm`, `md`, `lg`.

**Props**: `teamId`, `teamName`, `avatarUrl`, `size`, `className`

**Used in**: Task cards, ticket columns, ticket details/properties, client portal views, picker components

---

## Integration Points

| Component | Package | Team Functionality | Feature Flag |
|---|---|---|---|
| TaskForm | projects | Assign team via primary/additional agent pickers | Yes |
| TaskCard | projects | Display team badge | Yes |
| TaskListView | projects | Team column in list | Yes |
| KanbanBoard / StatusColumn | projects | Team badge on cards | Yes |
| ProjectDetail | projects | Team data management, avatar batch fetch | Yes |
| TemplateTaskForm | projects | Assign team in template tasks | Yes |
| TemplateEditor | projects | Team name/avatar state, pass to child components | Yes |
| TemplateTaskListView | projects | Team badge display | Yes |
| TemplateTasksStep | projects | Team assignment in wizard | Yes |
| TicketDetails | tickets | Team assignment/removal handlers | Yes |
| TicketInfo | tickets | Primary assignee with team picker, team badge | Yes |
| TicketProperties | tickets | Additional agents with team picker, team badge/removal dialog | Yes |
| QuickAddTicket | tickets | Team assignment, board default team | Yes |
| TicketingDashboard | tickets | Team filter, team avatars in columns | Yes |
| ticket-columns | tickets | Team avatar in assigned-to column | Yes |
| optimizedTicketActions | tickets | Team join, team filter in queries | N/A (backend) |
| ClientKanbanBoard | client-portal | Read-only team badge on tasks | No (display only) |
| ClientTaskListView | client-portal | Read-only team badge in list | No (display only) |
| TicketDetails (client) | client-portal | Read-only team badge | No (display only) |
| TicketList (client) | client-portal | Team avatar in columns | No (display only) |
| UserDetails | server/settings | Reports-to dropdown | Yes |
| OrgChart | server/settings | Org chart visualization | Yes |
| BoardsSettings | server/settings | Default team per board | Yes |

---

## Feature Flag

All teams-v2 UI is gated behind the `teams-v2` PostHog feature flag:

```typescript
const { enabled: teamsV2Enabled } = useFeatureFlag('teams-v2', { defaultValue: false });
```

When disabled:
- Standard `UserPicker` / `MultiUserPicker` are rendered instead of team-aware pickers
- Team badges, team assignment UI, and org chart are hidden
- Database columns exist but remain null
- Client portal team display is unconditional (shows data if present)

---

## Type Definitions

### Team Types — `packages/types/src/interfaces/auth.interfaces.ts`

```typescript
interface ITeamMember extends IUserWithRoles {
  role: 'member' | 'lead';
}

interface ITeam extends TenantEntity {
  team_id: string;
  team_name: string;
  manager_id: string | null;
  members: ITeamMember[];
}
```

### Ticket — `packages/types/src/interfaces/ticket.interfaces.ts`

```typescript
interface ITicket {
  assigned_team_id?: string | null;  // FK to teams
}

interface ITicketListItem {
  assigned_team_name?: string | null;  // Joined from teams table
}

interface ITicketListFilters {
  assignedTeamIds?: string[];  // Filter by team IDs
}
```

### Project Template Task — `packages/types/src/interfaces/projectTemplate.interfaces.ts`

```typescript
interface IProjectTemplateTask {
  assigned_team_id?: string | null;  // FK to teams
}
```

### Template Wizard — `packages/projects/src/types/templateWizard.ts`

```typescript
interface TemplateTask {
  assigned_team_id?: string;
}
```
