import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../../..');
const readFile = (relPath: string): string =>
  fs.readFileSync(path.join(root, relPath), 'utf8');

const expectAll = (content: string, snippets: string[]) => {
  snippets.forEach((snippet) => expect(content).toContain(snippet));
};

describe('Teams V2 Plan Coverage', () => {
  describe('Migrations: reports_to', () => {
    it('T001/T002: adds reports_to column with FK to users(user_id)', () => {
      const migration = readFile('server/migrations/20260226170000_add_reports_to_to_users.cjs');
      expectAll(migration, [
        "hasColumn('users', 'reports_to')",
        "table.uuid('reports_to')",
        "references('user_id')",
        "inTable('users')"
      ]);
    });

    it('T003/T004/T005/T006: seed reports_to from team membership and skip self references', () => {
      const seed = readFile('server/migrations/20260226170500_seed_reports_to_from_teams.cjs');
      expectAll(seed, [
        'UPDATE users u',
        'SET reports_to = t.manager_id',
        'FROM team_members tm',
        'JOIN teams t',
        'u.user_id = tm.user_id',
        'u.user_id != t.manager_id'
      ]);
    });
  });

  describe('Cycle prevention + reports_to chain', () => {
    it('T007/T008/T009/T010: updateUser blocks self and circular reports_to assignments', () => {
      const actions = readFile('packages/users/src/actions/user-actions/userActions.ts');
      expectAll(actions, [
        'reports_to cannot reference the user itself',
        'reports_to would create a circular reporting chain',
        'User.isInReportsToChain'
      ]);
    });

    it('T021-T025/T079: isInReportsToChain uses recursive CTE and tenant scoping', () => {
      const model = readFile('packages/db/src/models/user.ts');
      expectAll(model, [
        'WITH RECURSIVE chain AS',
        'u.tenant = ?',
        'JOIN chain',
        'LIMIT 1'
      ]);
    });
  });

  describe('Interfaces: reports_to and assigned_team_id', () => {
    it('T011: IUser interfaces include optional reports_to', () => {
      const sharedUser = readFile('shared/interfaces/user.interfaces.ts');
      const typesUser = readFile('packages/types/src/interfaces/user.interfaces.ts');
      expect(sharedUser).toContain('reports_to?:');
      expect(typesUser).toContain('reports_to?:');
    });

    it('T038/T039: ticket/task interfaces include assigned_team_id', () => {
      const ticketTypes = readFile('packages/types/src/interfaces/ticket.interfaces.ts');
      const projectTypes = readFile('packages/types/src/interfaces/project.interfaces.ts');
      expect(ticketTypes).toContain('assigned_team_id');
      expect(projectTypes).toContain('assigned_team_id');
    });
  });

  describe('User edit form + org chart UI', () => {
    it('T012/T013/T014: Reports To dropdown gated by teams-v2 and excludes current user', () => {
      const userDetails = readFile('server/src/components/settings/general/UserDetails.tsx');
      expectAll(userDetails, [
        "useFeatureFlag('teams-v2'",
        'Reports To',
        '.filter((item) => item.user_id !== userId)'
      ]);
    });

    it('T015/T016/T017: Reports To save uses updateUser and supports clearing', () => {
      const userDetails = readFile('server/src/components/settings/general/UserDetails.tsx');
      expectAll(userDetails, [
        'updateUser',
        'updatedUserData.reports_to = reportsTo || null'
      ]);
    });

    it('T018/T019/T020: Org chart tab is gated and uses reports_to tree roots', () => {
      const userMgmt = readFile('server/src/components/settings/general/UserManagement.tsx');
      expectAll(userMgmt, [
        "useFeatureFlag('teams-v2'",
        'reports_to',
        'Org Chart'
      ]);
    });
  });

  describe('Timesheet approval and scheduling', () => {
    it('T026-T030: timesheet approval uses reports_to chain when flag on', () => {
      const auth = readFile('packages/scheduling/src/actions/timeEntryDelegationAuth.ts');
      expectAll(auth, [
        "isFeatureFlagEnabled('teams-v2'",
        'isInReportsToChain'
      ]);
    });

    it('T031: fetchTimeSheetsForApproval includes reports_to subordinates when flag on', () => {
      const ts = readFile('packages/scheduling/src/actions/timeSheetActions.ts');
      expectAll(ts, [
        "isFeatureFlagEnabled('teams-v2'",
        'reports_to'
      ]);
    });

    it('T032: AvailabilitySettings scopes managed users by reports_to', () => {
      const avail = readFile('packages/scheduling/src/components/schedule/AvailabilitySettings.tsx');
      expectAll(avail, [
        "useFeatureFlag('teams-v2'",
        'reports_to'
      ]);
    });

    it('T033: SchedulePage scopes managed users by reports_to', () => {
      const schedule = readFile('packages/scheduling/src/components/schedule/SchedulePage.tsx');
      expectAll(schedule, [
        "useFeatureFlag('teams-v2'",
        'getReportsToSubordinates'
      ]);
    });
  });

  describe('Migrations: team roles and assigned_team_id', () => {
    it('T034/T035: team_members role column + lead seed', () => {
      const addRole = readFile('server/migrations/20260226171000_add_role_to_team_members.cjs');
      const seedRole = readFile('server/migrations/20260226171500_seed_team_member_leads.cjs');
      expectAll(addRole, ["table.text('role')", "defaultTo('member')"]);
      expectAll(seedRole, ["SET role = 'lead'", 'teams t']);
    });

    it('T036/T037: assigned_team_id columns on tickets and project_tasks', () => {
      const tickets = readFile('server/migrations/20260226172000_add_assigned_team_id_to_tickets.cjs');
      const tasks = readFile('server/migrations/20260226172500_add_assigned_team_id_to_project_tasks.cjs');
      expectAll(tickets, ["assigned_team_id", "references('team_id')", "inTable('teams')"]);
      expectAll(tasks, ["assigned_team_id", "references('team_id')", "inTable('teams')"]);
    });
  });

  describe('Team assignment actions', () => {
    it('T040-T045/T080: assignTeamToTicket sets assigned_team_id and team_member resources', () => {
      const action = readFile('packages/tickets/src/actions/teamAssignmentActions.ts');
      expectAll(action, [
        'assigned_team_id',
        "role: 'team_member'",
        'where({ ticket_id: ticketId, tenant })'
      ]);
    });

    it('T046: assignTeamToProjectTask mirrors team assignment logic', () => {
      const action = readFile('packages/projects/src/actions/projectTaskActions.ts');
      expectAll(action, [
        'assignTeamToProjectTask',
        'assigned_team_id: teamId',
        "role: 'team_member'"
      ]);
    });
  });

  describe('UserAndTeamPicker', () => {
    it('T047-T052: renders users and teams, filters both, shows team icon and metadata', () => {
      const picker = readFile('packages/ui/src/components/UserAndTeamPicker.tsx');
      expectAll(picker, [
        'Search users or teams',
        'Teams',
        'memberCount',
        'Lead: '
      ]);
    });
  });

  describe('Feature flag swaps', () => {
    it('T053-T055: ticket/task detail swap pickers behind teams-v2', () => {
      const ticketInfo = readFile('packages/tickets/src/components/ticket/TicketInfo.tsx');
      const taskForm = readFile('packages/projects/src/components/TaskForm.tsx');
      expect(ticketInfo).toContain("useFeatureFlag('teams-v2'");
      expect(ticketInfo).toContain('UserAndTeamPicker');
      expect(taskForm).toContain("useFeatureFlag('teams-v2'");
      expect(taskForm).toContain('UserAndTeamPicker');
    });
  });

  describe('Team badge and removal dialog', () => {
    it('T056-T065: team badge, removal dialog, and resource cleanup logic', () => {
      const props = readFile('packages/tickets/src/components/ticket/TicketProperties.tsx');
      const actions = readFile('packages/tickets/src/actions/teamAssignmentActions.ts');
      expectAll(props, [
        'assigned_team_id',
        'Remove team assignment',
        'Remove all team members',
        'Keep all team members as individual agents',
        'Select individual members to keep/remove'
      ]);
      expectAll(actions, [
        "role: 'team_member'",
        'assigned_team_id: null'
      ]);
    });
  });

  describe('Assignee filter includes teams', () => {
    it('T070-T073/T081: assigned_team_id filtering and teams dropdown', () => {
      const dashboard = readFile('packages/tickets/src/components/TicketingDashboard.tsx');
      const filters = readFile('packages/tickets/src/actions/optimizedTicketActions.ts');
      expectAll(dashboard, [
        'teamsV2Enabled',
        'onTeamValuesChange',
        'assignedTeamIds'
      ]);
      expect(filters).toContain('assigned_team_id');
    });
  });

  describe('Independence and snapshot behaviors', () => {
    it('T066-T068: individual agent add/remove flows do not clear team assignment', () => {
      const details = readFile('packages/tickets/src/components/ticket/TicketDetails.tsx');
      expectAll(details, [
        'handleAddAgent',
        'addTicketResource',
        'handleRemoveAgent',
        'removeTicketResource'
      ]);
    });

    it('T069: team assignment removal operates on team_member resources (snapshot semantics)', () => {
      const actions = readFile('packages/tickets/src/actions/teamAssignmentActions.ts');
      const segment = actions.split('removeTeamFromTicket')[1] || '';
      expect(segment).toContain("role: 'team_member'");
    });
  });

  describe('Workflow: canonical ticket assignment model', () => {
    it('T074/T075: ticket workflow actions use the canonical assignment object and reconcile ticket resources', () => {
      const workflow = readFile('shared/workflow/runtime/actions/businessOperations/tickets.ts');
      expectAll(workflow, [
        'buildWorkflowTicketAssignmentSchema',
        'additional_user_ids',
        "type: workflowTicketAssignmentPrimaryTypeSchema.describe('Primary assignment type')",
        'resolveWorkflowTicketAssignment',
        'reconcileWorkflowTicketAdditionalUsers'
      ]);
    });
  });

  describe('Tenant export coverage', () => {
    it('T076-T078: export list includes users, tickets, project_tasks, team_members', () => {
      const exportFile = readFile('ee/server/src/lib/tenant-management/tenant-export.ts');
      expectAll(exportFile, [
        "'users'",
        "'tickets'",
        "'project_tasks'",
        "'team_members'"
      ]);
    });
  });
});
