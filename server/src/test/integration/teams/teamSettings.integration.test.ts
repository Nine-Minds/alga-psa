import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from 'server/test-utils/testContext';
import { createUser } from 'server/test-utils/testDataFactory';

import {
  saveTeamChanges,
  removeUserFromTeam,
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
    ctx = await helpers.beforeAll({});
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
});
