import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from 'server/test-utils/testContext';
import { createUser } from 'server/test-utils/testDataFactory';

import {
  saveTeamChanges,
  removeUserFromTeam,
  deleteTeam,
  updateTeam,
  getTeamById,
} from '@alga-psa/teams/actions/team-actions/teamActions';
import { isTeamActionError, teamActionErrorMessage } from '@alga-psa/teams/actions/team-actions/teamActionErrors';

const dbRef = vi.hoisted(() => ({ knex: null as any, tenant: '' as string }));
const userRef = vi.hoisted(() => ({ user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => {
  const wrap = (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args);
  return {
    withAuth: wrap,
    withOptionalAuth: wrap,
    withAuthCheck: wrap,
    hasPermission: vi.fn(async () => true),
    getCurrentUser: vi.fn(async () => userRef.user),
    getSession: vi.fn(async () => ({ user: { id: userRef.user?.user_id, tenant: dbRef.tenant } })),
  };
});

const HOOK_TIMEOUT = 240_000;
const helpers = TestContext.createHelpers();

describe('Team settings (alga-2026-0002379 Bug B)', () => {
  let ctx: TestContext;
  let lead: string;
  let memberA: string;
  let memberB: string;
  let teamId: string;

  const table = (name: string) => tenantDb(ctx.db, ctx.tenantId).table(name);
  const memberIds = async () =>
    (await table('team_members').where({ team_id: teamId }).select('user_id')).map((r: any) => r.user_id).sort();

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['calendar_shares'] });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    dbRef.knex = ctx.db;
    dbRef.tenant = ctx.tenantId;

    lead = await createUser(ctx.db, ctx.tenantId, { first_name: 'Lena', last_name: 'Lead' });
    memberA = await createUser(ctx.db, ctx.tenantId, { first_name: 'Max', last_name: 'A' });
    memberB = await createUser(ctx.db, ctx.tenantId, { first_name: 'Mia', last_name: 'B' });
    userRef.user = { user_id: lead, tenant: ctx.tenantId, user_type: 'internal', roles: [] };

    teamId = uuidv4();
    await table('teams').insert({ tenant: ctx.tenantId, team_id: teamId, team_name: 'Service desk', manager_id: lead });
    await table('team_members').insert([
      { tenant: ctx.tenantId, team_id: teamId, user_id: lead, role: 'lead' },
      { tenant: ctx.tenantId, team_id: teamId, user_id: memberA, role: 'member' },
      { tenant: ctx.tenantId, team_id: teamId, user_id: memberB, role: 'member' },
    ]);
  }, HOOK_TIMEOUT);

  it('happy path: saves a lead change, an addition and a removal in one save', async () => {
    const extra = await createUser(ctx.db, ctx.tenantId, { first_name: 'Eli', last_name: 'Extra' });
    const result = await saveTeamChanges(teamId, { managerId: memberA, addUserIds: [extra], removeUserIds: [memberB] });

    expect(isTeamActionError(result)).toBe(false);
    const team = await table('teams').where({ team_id: teamId }).first();
    expect(team.manager_id).toBe(memberA);
    expect(await memberIds()).toEqual([lead, memberA, extra].sort());
    const roles = Object.fromEntries((await table('team_members').where({ team_id: teamId })).map((r: any) => [r.user_id, r.role]));
    expect(roles[memberA]).toBe('lead');
    expect(roles[lead]).toBe('member');
  });

  describe('removing a member', () => {
    it('removes a non-lead member via the batch save', async () => {
      const result = await saveTeamChanges(teamId, { addUserIds: [], removeUserIds: [memberB] });
      expect(isTeamActionError(result)).toBe(false);
      expect(await memberIds()).toEqual([lead, memberA].sort());
    });

    it('removes a non-lead member via removeUserFromTeam', async () => {
      const result = await removeUserFromTeam(teamId, memberA);
      expect(isTeamActionError(result)).toBe(false);
      expect(await memberIds()).toEqual([lead, memberB].sort());
    });

    it('removes a member who is referenced by a team-scoped assignment without failing', async () => {
      // Members keep working as normal users elsewhere; removal must only touch team_members.
      const result = await saveTeamChanges(teamId, { addUserIds: [], removeUserIds: [memberA, memberB] });
      expect(isTeamActionError(result)).toBe(false);
      expect(await memberIds()).toEqual([lead]);
    });

    it('refuses to remove the current lead and says why', async () => {
      const result = await saveTeamChanges(teamId, { addUserIds: [], removeUserIds: [lead] });
      expect(isTeamActionError(result)).toBe(true);
      expect(teamActionErrorMessage(result)).toMatch(/team lead/i);
      expect(await memberIds()).toEqual([lead, memberA, memberB].sort());
    });

    it('removes the old lead when a new lead is chosen in the same save', async () => {
      const result = await saveTeamChanges(teamId, { managerId: memberA, addUserIds: [], removeUserIds: [lead] });
      expect(isTeamActionError(result)).toBe(false);
      expect(await memberIds()).toEqual([memberA, memberB].sort());
    });
  });

  describe('setting the team lead to "Not Assigned"', () => {
    it('clears the lead via the batch save (managerId: null) and keeps members', async () => {
      const result = await saveTeamChanges(teamId, { managerId: null, addUserIds: [], removeUserIds: [] });
      expect(isTeamActionError(result)).toBe(false);

      const team = await table('teams').where({ team_id: teamId }).first();
      expect(team.manager_id).toBeNull();
      expect(await memberIds()).toEqual([lead, memberA, memberB].sort());
      const leads = await table('team_members').where({ team_id: teamId, role: 'lead' });
      expect(leads).toHaveLength(0);

      const reloaded = await getTeamById(teamId);
      expect(isTeamActionError(reloaded)).toBe(false);
      expect((reloaded as any).manager_id).toBeNull();
    });

    it('allows removing the former lead once the lead is cleared in the same save', async () => {
      const result = await saveTeamChanges(teamId, { managerId: null, addUserIds: [], removeUserIds: [lead] });
      expect(isTeamActionError(result)).toBe(false);
      expect(await memberIds()).toEqual([memberA, memberB].sort());
    });

    it('clears the lead via updateTeam({ manager_id: null })', async () => {
      const result = await updateTeam(teamId, { manager_id: null });
      expect(isTeamActionError(result)).toBe(false);
      expect(((await table('teams').where({ team_id: teamId }).first()) as any).manager_id).toBeNull();
    });

    it('leaves the lead untouched when managerId is omitted (undefined = no change)', async () => {
      const result = await saveTeamChanges(teamId, { addUserIds: [], removeUserIds: [memberB] });
      expect(isTeamActionError(result)).toBe(false);
      expect(((await table('teams').where({ team_id: teamId }).first()) as any).manager_id).toBe(lead);
    });
  });

  describe('deleting a team', () => {
    it('deletes a team that has members and removes only its member rows and calendar shares', async () => {
      const calendarId = uuidv4();
      await table('calendars').insert({
        tenant: ctx.tenantId, calendar_id: calendarId, calendar_type: 'personal', owner_user_id: lead,
      });
      await table('calendar_shares').insert({
        tenant: ctx.tenantId, calendar_id: calendarId, grantee_type: 'team', grantee_id: teamId, access_level: 'read',
      });

      const result = await deleteTeam(teamId);

      expect(result.success).toBe(true);
      expect(await table('teams').where({ team_id: teamId }).first()).toBeUndefined();
      expect(await table('team_members').where({ team_id: teamId })).toHaveLength(0);
      expect(await table('calendar_shares').where({ grantee_type: 'team', grantee_id: teamId })).toHaveLength(0);
      // The shared calendar itself is not the team's to delete.
      expect(await table('calendars').where({ calendar_id: calendarId }).first()).toBeDefined();
      // Users themselves are never touched.
      expect(await table('users').whereIn('user_id', [lead, memberA, memberB])).toHaveLength(3);
    });

    it('clears the board default team on delete (config reference, not ticket data)', async () => {
      const boardId = uuidv4();
      await table('boards').insert({
        tenant: ctx.tenantId, board_id: boardId, board_name: 'Support', default_assigned_team_id: teamId,
      });

      const result = await deleteTeam(teamId);

      expect(result.success).toBe(true);
      const board = await table('boards').where({ board_id: boardId }).first();
      expect(board).toBeDefined();
      expect(board.default_assigned_team_id).toBeNull();
    });

    it('blocks deletion with a clear reason when tickets are assigned to the team and leaves ticket data untouched', async () => {
      const { ticketId } = await insertTicketAssignedToTeam();

      const result = await deleteTeam(teamId);

      expect(result.success).toBe(false);
      expect(result.canDelete).toBe(false);
      expect(result.dependencies.map((d) => d.type)).toContain('ticket');
      expect(result.dependencies.map((d) => d.type)).not.toContain('member');
      expect(result.message).toMatch(/assigned ticket/i);

      expect(await table('teams').where({ team_id: teamId }).first()).toBeDefined();
      const ticket = await table('tickets').where({ ticket_id: ticketId }).first();
      expect(ticket.assigned_team_id).toBe(teamId);
      expect(await memberIds()).toEqual([lead, memberA, memberB].sort());
    });
  });

  async function insertTicketAssignedToTeam(): Promise<{ ticketId: string }> {
    const existing = await table('tickets').first();
    const ticketId = uuidv4();
    const board = await table('boards').first();
    const status = await table('statuses').where({ status_type: 'ticket' }).first();
    const client = await table('clients').first();
    const boardId = board?.board_id ?? uuidv4();
    if (!board) {
      await table('boards').insert({ tenant: ctx.tenantId, board_id: boardId, board_name: 'Support' });
    }
    await table('tickets').insert({
      tenant: ctx.tenantId,
      ticket_id: ticketId,
      ticket_number: `T-${Math.floor(Math.random() * 1e9)}`,
      title: 'Printer down',
      board_id: boardId,
      status_id: status?.status_id ?? existing?.status_id,
      client_id: client?.client_id ?? existing?.client_id,
      entered_by: lead,
      assigned_team_id: teamId,
    });
    return { ticketId };
  }
});
