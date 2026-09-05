import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

/**
 * Ticket assignment / additional-agent behaviour against a real Postgres.
 *
 * These helpers exist to sequence writes around the `ticket_resources`
 * constraints — a NO ACTION foreign key on (tenant, ticket_id, assigned_to)
 * and CHECK (assigned_to != additional_user_id) — so they are only meaningfully
 * covered where those constraints are actually enforced.
 */

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({ user: null as any }));
const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const publishEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const publishWorkflowEventMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));
vi.mock('@alga-psa/auth/actions', () => ({ getTicketAttributes: vi.fn(async () => ({})) }));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn() })),
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  captureAnalytics: vi.fn(),
  ServerAnalyticsTracker: class {},
  analytics: { capture: vi.fn() },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));

import { tenantDb, withTransaction } from '@alga-psa/db';
import { prepareTicketResourceReassignment } from '../../../../packages/db/src/lib/reassignTicketResources';
import {
  addTicketResourceCore,
  getTicketResourcesCore,
  removeTicketResourceCore,
} from '../../../../packages/tickets/src/lib/ticketResourceCore';
import {
  assignTeamToTicketCore,
  removeTeamFromTicketCore,
} from '../../../../packages/tickets/src/lib/teamAssignmentCore';
import { updateTicket } from '../../../../packages/tickets/src/actions/ticketActions';

const HOOK_TIMEOUT = 300_000;

let db: Knex;
let tenantId: string;
let otherTenantId: string;
let actorId: string;
let userA: string;
let userB: string;
let userC: string;
let inactiveUserId: string;
let clientId: string;
let boardId: string;
let statusId: string;
let ticketId: string;
let teamId: string;

function scoped(table: string, tenant: string = tenantId) {
  return tenantDb(db, tenant).table(table);
}

async function insertUser(tenant: string, isInactive = false): Promise<string> {
  const userId = uuidv4();
  await scoped('users', tenant).insert({
    tenant,
    user_id: userId,
    username: `assign-${userId}`,
    email: `assign-${userId}@example.test`,
    hashed_password: 'x',
    first_name: 'Assign',
    last_name: userId.slice(0, 8),
    user_type: 'internal',
    is_inactive: isInactive,
  });
  return userId;
}

async function insertTicket(tenant: string, client: string, assignedTo: string | null): Promise<string> {
  const id = uuidv4();
  await scoped('tickets', tenant).insert({
    tenant,
    ticket_id: id,
    ticket_number: `T-${id.slice(0, 8)}`,
    title: 'Assignment fixture ticket',
    client_id: client,
    board_id: tenant === tenantId ? boardId : null,
    status_id: tenant === tenantId ? statusId : null,
    assigned_to: assignedTo,
    entered_by: tenant === tenantId ? actorId : null,
    entered_at: new Date(),
    is_closed: false,
  });
  return id;
}

async function addResource(
  tenant: string,
  ticket: string,
  assignedTo: string,
  additionalUserId: string,
  role = 'support'
): Promise<string> {
  const [row] = await scoped('ticket_resources', tenant)
    .insert({
      tenant,
      ticket_id: ticket,
      assigned_to: assignedTo,
      additional_user_id: additionalUserId,
      role,
      assigned_at: new Date(),
    })
    .returning('assignment_id');
  return typeof row === 'string' ? row : row.assignment_id;
}

function resourcesFor(ticket: string, tenant: string = tenantId) {
  return scoped('ticket_resources', tenant).where({ ticket_id: ticket }).select('*');
}

describe('ticket assignment and additional agents', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    dbRef.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of a seeded internal user for the assignment integration suite')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    tenantId = seededUser.tenant;
    dbRef.tenant = tenantId;
    actorId = seededUser.user_id;
    userRef.user = {
      user_id: seededUser.user_id,
      user_type: 'internal',
      first_name: seededUser.first_name ?? 'Test',
      last_name: seededUser.last_name ?? 'User',
      username: seededUser.username,
      tenant: tenantId,
    };

    const suffix = uuidv4().slice(0, 8);
    clientId = uuidv4();
    await scoped('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Assignment Client ${suffix}`,
    });

    boardId = uuidv4();
    await scoped('boards').insert({
      tenant: tenantId,
      board_id: boardId,
      board_name: `Assignment Board ${suffix}`,
      is_default: false,
      is_inactive: false,
      display_order: 998,
    });

    statusId = uuidv4();
    await scoped('statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      board_id: boardId,
      name: 'Open',
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: actorId,
    });

    userA = await insertUser(tenantId);
    userB = await insertUser(tenantId);
    userC = await insertUser(tenantId);
    inactiveUserId = await insertUser(tenantId, true);

    teamId = uuidv4();
    await scoped('teams').insert({
      tenant: tenantId,
      team_id: teamId,
      team_name: `Assignment Team ${suffix}`,
      manager_id: userA,
    });
    await scoped('team_members').insert([
      { tenant: tenantId, team_id: teamId, user_id: userA },
      { tenant: tenantId, team_id: teamId, user_id: userB },
      { tenant: tenantId, team_id: teamId, user_id: inactiveUserId },
    ]);

    // A second tenant carrying the *same* shape, to prove the helpers stay
    // inside the tenant they were handed.
    otherTenantId = uuidv4();
    await db('tenants').insert({
      tenant: otherTenantId,
      client_name: `Other Tenant ${suffix}`,
      email: `other-${suffix}@example.test`,
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  beforeEach(async () => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    publishEventMock.mockClear();
    publishWorkflowEventMock.mockClear();

    await scoped('ticket_resources').where({ assigned_to: userA }).delete();
    ticketId = await insertTicket(tenantId, clientId, userA);
  });

  describe('prepareTicketResourceReassignment', () => {
    async function reassign(from: string | null, to: string | null, target = ticketId) {
      await withTransaction(db, async (trx) => {
        const finalize = await prepareTicketResourceReassignment(trx, tenantId, target, from, to);
        await tenantDb(trx, tenantId).table('tickets').where({ ticket_id: target }).update({ assigned_to: to });
        await finalize();
      });
      return resourcesFor(target);
    }

    it('re-keys the additional agents to the new primary assignee', async () => {
      await addResource(tenantId, ticketId, userA, userB, 'support');
      await addResource(tenantId, ticketId, userA, userC, 'team_member');

      const resources = await reassign(userA, actorId);

      expect(resources).toHaveLength(2);
      expect(resources.every((row: any) => row.assigned_to === actorId)).toBe(true);
      expect(resources.map((row: any) => row.additional_user_id).sort()).toEqual([userB, userC].sort());
      expect(resources.map((row: any) => row.role).sort()).toEqual(['support', 'team_member']);
    });

    it('absorbs an additional agent who becomes the primary assignee', async () => {
      await addResource(tenantId, ticketId, userA, userB);
      await addResource(tenantId, ticketId, userA, userC);

      const resources = await reassign(userA, userB);

      expect(resources).toHaveLength(1);
      expect(resources[0]).toMatchObject({ assigned_to: userB, additional_user_id: userC });
    });

    it('drops the additional agents when the ticket is unassigned', async () => {
      await addResource(tenantId, ticketId, userA, userB);

      expect(await reassign(userA, null)).toHaveLength(0);
    });

    it('leaves the additional agents of another tenant alone', async () => {
      const otherClientId = uuidv4();
      await scoped('clients', otherTenantId).insert({
        tenant: otherTenantId,
        client_id: otherClientId,
        client_name: 'Other tenant client',
      });
      const otherUserA = await insertUser(otherTenantId);
      const otherUserB = await insertUser(otherTenantId);
      const otherTicketId = await insertTicket(otherTenantId, otherClientId, otherUserA);
      await addResource(otherTenantId, otherTicketId, otherUserA, otherUserB);

      await addResource(tenantId, ticketId, userA, userB);
      await reassign(userA, actorId);

      const otherResources = await resourcesFor(otherTicketId, otherTenantId);
      expect(otherResources).toHaveLength(1);
      expect(otherResources[0]).toMatchObject({ assigned_to: otherUserA, additional_user_id: otherUserB });
    });

    // The ordering is the whole point of the helper: the FK is NO ACTION, so
    // re-inserting before `tickets.assigned_to` moves is rejected by Postgres.
    it('cannot re-key the resources before the ticket update lands', async () => {
      await addResource(tenantId, ticketId, userA, userB);

      await expect(
        withTransaction(db, async (trx) => {
          const finalize = await prepareTicketResourceReassignment(trx, tenantId, ticketId, userA, actorId);
          await finalize();
        })
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });

  // The bug this suite was written for: every reassignment of a ticket that had
  // additional agents used to fail with "Invalid reference".
  describe('updateTicket', () => {
    it('reassigns a ticket that has additional agents', async () => {
      await addResource(tenantId, ticketId, userA, userB, 'support');

      const updated: any = await updateTicket(ticketId, { assigned_to: actorId } as any);
      expect(updated?.assigned_to ?? (await scoped('tickets').where({ ticket_id: ticketId }).first()).assigned_to)
        .toBe(actorId);

      const resources = await resourcesFor(ticketId);
      expect(resources).toHaveLength(1);
      expect(resources[0]).toMatchObject({ assigned_to: actorId, additional_user_id: userB, role: 'support' });
    });

    it('keeps the additional agents when the update does not touch assigned_to', async () => {
      await addResource(tenantId, ticketId, userA, userB);

      await updateTicket(ticketId, { title: 'Renamed but still assigned' } as any);

      const resources = await resourcesFor(ticketId);
      expect(resources).toHaveLength(1);
      expect(resources[0].assigned_to).toBe(userA);
    });
  });

  describe('assignTeamToTicketCore', () => {
    async function assignTeam(target = ticketId) {
      return withTransaction(db, (trx) => assignTeamToTicketCore(trx, tenantId, actorId, target, teamId));
    }

    it('falls back to the team lead and adds only the active members', async () => {
      const unassigned = await insertTicket(tenantId, clientId, null);

      const assignedTo = await assignTeam(unassigned);

      expect(assignedTo).toBe(userA);
      const ticket = await scoped('tickets').where({ ticket_id: unassigned }).first();
      expect(ticket).toMatchObject({ assigned_team_id: teamId, assigned_to: userA, updated_by: actorId });

      const resources = await resourcesFor(unassigned);
      expect(resources).toHaveLength(1);
      expect(resources[0]).toMatchObject({ additional_user_id: userB, assigned_to: userA, role: 'team_member' });
      expect(resources.map((row: any) => row.additional_user_id)).not.toContain(inactiveUserId);
    });

    it('keeps an existing primary agent and keys the members to them', async () => {
      const assignedTo = await assignTeam();

      expect(assignedTo).toBe(userA);
      const resources = await resourcesFor(ticketId);
      expect(resources).toHaveLength(1);
      expect(resources[0]).toMatchObject({ additional_user_id: userB, assigned_to: userA });
    });

    it('does not duplicate members who are already additional agents', async () => {
      await addResource(tenantId, ticketId, userA, userB, 'support');

      await assignTeam();

      const forUserB = (await resourcesFor(ticketId)).filter((row: any) => row.additional_user_id === userB);
      expect(forUserB).toHaveLength(1);
      expect(forUserB[0].role).toBe('support');
    });

    it('rejects an unknown ticket or team', async () => {
      await expect(assignTeam(uuidv4())).rejects.toThrow('Ticket not found');
      await expect(
        withTransaction(db, (trx) => assignTeamToTicketCore(trx, tenantId, actorId, ticketId, uuidv4()))
      ).rejects.toThrow('Team not found');
    });
  });

  describe('removeTeamFromTicketCore', () => {
    beforeEach(async () => {
      await addResource(tenantId, ticketId, userA, userB, 'team_member');
      await addResource(tenantId, ticketId, userA, userC, 'team_member');
      await addResource(tenantId, ticketId, userA, actorId, 'support');
      await scoped('tickets').where({ ticket_id: ticketId }).update({ assigned_team_id: teamId });
    });

    async function removeTeam(options: any) {
      await withTransaction(db, (trx) =>
        removeTeamFromTicketCore(trx, tenantId, actorId, ticketId, options)
      );
      return resourcesFor(ticketId);
    }

    it('remove_all drops the team members but keeps other additional agents', async () => {
      const resources = await removeTeam({ mode: 'remove_all' });

      expect(resources.map((row: any) => row.additional_user_id)).toEqual([actorId]);
      expect((await scoped('tickets').where({ ticket_id: ticketId }).first()).assigned_team_id).toBeNull();
    });

    it('keep_all leaves every additional agent in place', async () => {
      const resources = await removeTeam({ mode: 'keep_all' });

      expect(resources).toHaveLength(3);
      expect((await scoped('tickets').where({ ticket_id: ticketId }).first()).assigned_team_id).toBeNull();
    });

    it('selective keeps only the listed team members', async () => {
      const resources = await removeTeam({ mode: 'selective', keepUserIds: [userC] });

      expect(resources.map((row: any) => row.additional_user_id).sort()).toEqual([userC, actorId].sort());
    });

    it('rejects an unknown ticket', async () => {
      await expect(
        withTransaction(db, (trx) =>
          removeTeamFromTicketCore(trx, tenantId, actorId, uuidv4(), { mode: 'remove_all' })
        )
      ).rejects.toThrow('Ticket not found');
    });
  });

  describe('ticket resource core', () => {
    it('adds an additional agent keyed to the current primary assignee', async () => {
      const { resource, event } = await withTransaction(db, (trx) =>
        addTicketResourceCore(trx, tenantId, actorId, ticketId, userB, 'support')
      );

      expect(resource).toMatchObject({ ticket_id: ticketId, assigned_to: userA, additional_user_id: userB });
      expect(event).toEqual({
        eventType: 'TICKET_ADDITIONAL_AGENT_ASSIGNED',
        payload: {
          tenantId,
          ticketId,
          primaryAgentId: userA,
          additionalAgentId: userB,
          assignedByUserId: actorId,
        },
      });
      // The core hands the event back so the caller can emit it post-commit.
      expect(publishEventMock).not.toHaveBeenCalled();
    });

    it('promotes the user to primary when the ticket is unassigned', async () => {
      const unassigned = await insertTicket(tenantId, clientId, null);

      const { resource, event } = await withTransaction(db, (trx) =>
        addTicketResourceCore(trx, tenantId, actorId, unassigned, userB, 'support')
      );

      expect(resource).toBeNull();
      expect(event.eventType).toBe('TICKET_ASSIGNED');
      expect((await scoped('tickets').where({ ticket_id: unassigned }).first()).assigned_to).toBe(userB);
      expect(await resourcesFor(unassigned)).toHaveLength(0);
    });

    it('rejects a duplicate additional agent as a conflict', async () => {
      await addResource(tenantId, ticketId, userA, userB);

      const error = await withTransaction(db, (trx) =>
        addTicketResourceCore(trx, tenantId, actorId, ticketId, userB, 'support')
      ).catch((thrown) => thrown);

      expect(error).toMatchObject({ name: 'TicketResourceError', kind: 'conflict' });
    });

    it('reports a missing ticket as not found', async () => {
      await expect(
        withTransaction(db, (trx) =>
          addTicketResourceCore(trx, tenantId, actorId, uuidv4(), userB, 'support')
        )
      ).rejects.toMatchObject({ kind: 'not_found' });
    });

    it('lists a ticket resources newest first and skips other tickets', async () => {
      const other = await insertTicket(tenantId, clientId, userA);
      await addResource(tenantId, ticketId, userA, userB);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await addResource(tenantId, ticketId, userA, userC);
      await addResource(tenantId, other, userA, userB);

      const resources = await withTransaction(db, (trx) =>
        getTicketResourcesCore(trx, tenantId, ticketId)
      );

      expect(resources.map((row) => row.additional_user_id)).toEqual([userC, userB]);
    });

    it('removes an assignment row and reports unknown ones', async () => {
      const assignmentId = await addResource(tenantId, ticketId, userA, userB);

      await withTransaction(db, (trx) => removeTicketResourceCore(trx, tenantId, assignmentId));
      expect(await resourcesFor(ticketId)).toHaveLength(0);

      await expect(
        withTransaction(db, (trx) => removeTicketResourceCore(trx, tenantId, uuidv4()))
      ).rejects.toMatchObject({ kind: 'not_found' });
    });
  });
});
