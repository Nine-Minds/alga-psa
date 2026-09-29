import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { EventSchemas } from '@alga-psa/event-schemas';
import { TestContext } from 'server/test-utils/testContext';
import { createUser } from 'server/test-utils/testDataFactory';
import { TeamService } from 'server/src/lib/api/services/TeamService';

// The real event bus rejects any event type it has no schema for
// (EventBus.publish -> "Unknown event type"). Mirror that so a stray event stub
// in the service fails here the way it fails in production.
vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async (event: { eventType: string }) => {
    if (!(event.eventType in EventSchemas)) {
      throw new Error(`Unknown event type: ${event.eventType}`);
    }
  }),
}));

const HOOK_TIMEOUT = 240_000;
const helpers = TestContext.createHelpers();

describe('REST TeamService mutations (alga-2026-0002379 Bug B)', () => {
  let ctx: TestContext;
  let lead: string;
  let memberA: string;
  let memberB: string;
  let outsider: string;
  let teamId: string;
  const service = new TeamService();

  const table = (name: string) => tenantDb(ctx.db, ctx.tenantId).table(name);
  const context = () => ({ tenant: ctx.tenantId, userId: lead } as any);
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
    // BaseService resolves its connection from request context; hand it the test DB.
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: ctx.db, tenant: ctx.tenantId });

    lead = await createUser(ctx.db, ctx.tenantId, { first_name: 'Lena', last_name: 'Lead' });
    memberA = await createUser(ctx.db, ctx.tenantId, { first_name: 'Max', last_name: 'A' });
    memberB = await createUser(ctx.db, ctx.tenantId, { first_name: 'Mia', last_name: 'B' });
    outsider = await createUser(ctx.db, ctx.tenantId, { first_name: 'Otto', last_name: 'Out' });

    teamId = uuidv4();
    await table('teams').insert({ tenant: ctx.tenantId, team_id: teamId, team_name: 'Service desk', manager_id: lead });
    await table('team_members').insert([
      { tenant: ctx.tenantId, team_id: teamId, user_id: lead, role: 'lead' },
      { tenant: ctx.tenantId, team_id: teamId, user_id: memberA, role: 'member' },
      { tenant: ctx.tenantId, team_id: teamId, user_id: memberB, role: 'member' },
    ]);
  }, HOOK_TIMEOUT);

  it('adds a member', async () => {
    await service.addMember(teamId, outsider, context());
    expect(await memberIds()).toEqual([lead, memberA, memberB, outsider].sort());
  });

  it('removes a member', async () => {
    await service.removeMember(teamId, memberA, context());
    expect(await memberIds()).toEqual([lead, memberB].sort());
  });

  it('removes several members', async () => {
    await service.removeMembers(teamId, [memberA, memberB], context());
    expect(await memberIds()).toEqual([lead]);
  });

  it('clears the lead with manager_id: null', async () => {
    await service.update(teamId, { manager_id: null } as any, context());
    expect(((await table('teams').where({ team_id: teamId }).first()) as any).manager_id).toBeNull();
  });

  it('deletes a team with members', async () => {
    await service.delete(teamId, context());
    expect(await table('teams').where({ team_id: teamId }).first()).toBeUndefined();
    expect(await table('team_members').where({ team_id: teamId })).toHaveLength(0);
    expect(await table('users').whereIn('user_id', [lead, memberA, memberB])).toHaveLength(3);
  });

  it('refuses to delete a team that tickets are assigned to and leaves the ticket alone', async () => {
    const status = await table('statuses').where({ status_type: 'ticket' }).first();
    const client = await table('clients').first();
    const boardId = uuidv4();
    await table('boards').insert({ tenant: ctx.tenantId, board_id: boardId, board_name: 'Support' });
    const ticketId = uuidv4();
    await table('tickets').insert({
      tenant: ctx.tenantId, ticket_id: ticketId, ticket_number: `T-${Math.floor(Math.random() * 1e9)}`, title: 'Printer down',
      board_id: boardId, status_id: status.status_id, client_id: client.client_id, entered_by: lead, assigned_team_id: teamId,
    });

    await expect(service.delete(teamId, context())).rejects.toThrow(/assigned ticket/i);

    expect(await table('teams').where({ team_id: teamId }).first()).toBeDefined();
    expect(((await table('tickets').where({ ticket_id: ticketId }).first()) as any).assigned_team_id).toBe(teamId);
  });
});
