import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { TicketModel } from '@shared/models/ticketModel';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';

/**
 * DB-backed proof that the three newly supported sort keys actually execute
 * against PostgreSQL and agree with adjacent-ticket navigation.
 *
 * The validation/mapping unit tests prove the contract accepts the keys; they
 * cannot prove the SQL orders by the right expression. This suite seeds users,
 * teams and timestamps (including an unassigned ticket and tied assignees) and
 * compares getTicketsForList's order to an independent comparator, then checks
 * getAdjacentTicketIds reports the same neighbours.
 */

const authMocks = vi.hoisted(() => ({
  user: null as any,
  tenant: null as string | null,
  hasPermission: vi.fn(),
  scheduleJobAt: vi.fn(),
  cancelScheduledJob: vi.fn().mockResolvedValue(true),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) =>
    action(authMocks.user, { tenant: authMocks.tenant }, ...args),
  hasPermission: (...args: any[]) => authMocks.hasPermission(...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: authMocks.hasPermission }));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getEntityImageUrlsBatch: vi.fn().mockResolvedValue(new Map()),
}));

const describeDb = await describeWithDb();

type SeededTicket = {
  ticketId: string;
  assignedTo: string | null;
  assignedName: string;
  teamName: string | null;
  updatedAt: string;
};

let db: Knex;
let tenantId: string;
let statusId: string;
let priorityId: string;
let boardId: string;
let clientId: string;
let actorId: string;
let aliceId: string;
let bobId: string;
let teamAlphaId: string;
let teamBetaId: string;
let seeded: SeededTicket[] = [];

type OptimizedActions = typeof import('@alga-psa/tickets/actions/optimizedTicketActions');
let optimized: OptimizedActions;

async function seedFixture(): Promise<void> {
  tenantId = uuidv4();
  boardId = uuidv4();
  statusId = uuidv4();
  priorityId = uuidv4();
  clientId = uuidv4();
  actorId = uuidv4();
  aliceId = uuidv4();
  bobId = uuidv4();
  teamAlphaId = uuidv4();
  teamBetaId = uuidv4();

  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Sort Tenant ${tenantId.slice(0, 8)}`,
    email: `sort-${tenantId.slice(0, 8)}@example.com`,
    product_code: 'psa',
  });

  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Sort Client',
    is_inactive: false,
  });

  await db('boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Sort Board',
    is_default: true,
    is_inactive: false,
  });

  await db('users').insert([
    {
      tenant: tenantId,
      user_id: actorId,
      username: 'sort-actor',
      hashed_password: 'not-used',
      email: 'sort-actor@example.com',
      first_name: 'Actor',
      last_name: 'One',
      user_type: 'internal',
      is_inactive: false,
    },
    {
      tenant: tenantId,
      user_id: aliceId,
      username: 'sort-alice',
      hashed_password: 'not-used',
      email: 'sort-alice@example.com',
      first_name: 'Alice',
      last_name: 'Anderson',
      user_type: 'internal',
      is_inactive: false,
    },
    {
      tenant: tenantId,
      user_id: bobId,
      username: 'sort-bob',
      hashed_password: 'not-used',
      email: 'sort-bob@example.com',
      first_name: 'Bob',
      last_name: 'Brown',
      user_type: 'internal',
      is_inactive: false,
    },
  ]);

  await db('teams').insert([
    { tenant: tenantId, team_id: teamAlphaId, team_name: 'Alpha Team', manager_id: actorId },
    { tenant: tenantId, team_id: teamBetaId, team_name: 'Beta Team', manager_id: actorId },
  ]);

  await db('priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'High',
    created_by: actorId,
    order_number: 10,
  });

  await db('statuses').insert({
    tenant: tenantId,
    status_id: statusId,
    board_id: boardId,
    name: 'Open',
    status_type: 'ticket',
    is_closed: false,
    is_default: true,
    created_by: actorId,
    order_number: 10,
  });

  const plan: Array<{
    label: string;
    assignedTo: string | null;
    assignedName: string;
    teamId: string | null;
    teamName: string | null;
    updatedAt: string;
    enteredAt: string;
  }> = [
    {
      label: 'alice',
      assignedTo: aliceId,
      assignedName: 'Alice Anderson',
      teamId: teamAlphaId,
      teamName: 'Alpha Team',
      updatedAt: '2026-01-01T00:00:00.000Z',
      enteredAt: '2026-01-01T00:00:01.000Z',
    },
    {
      label: 'bob',
      assignedTo: bobId,
      assignedName: 'Bob Brown',
      teamId: teamBetaId,
      teamName: 'Beta Team',
      updatedAt: '2026-01-03T00:00:00.000Z',
      enteredAt: '2026-01-02T00:00:01.000Z',
    },
    {
      label: 'unassigned',
      assignedTo: null,
      assignedName: '',
      teamId: null,
      teamName: null,
      updatedAt: '2026-01-02T00:00:00.000Z',
      enteredAt: '2026-01-03T00:00:01.000Z',
    },
    {
      label: 'alice-tie',
      assignedTo: aliceId,
      assignedName: 'Alice Anderson',
      teamId: teamAlphaId,
      teamName: 'Alpha Team',
      updatedAt: '2026-01-04T00:00:00.000Z',
      enteredAt: '2026-01-04T00:00:01.000Z',
    },
  ];

  seeded = [];
  for (const item of plan) {
    const created = await db.transaction((trx) =>
      TicketModel.createTicket(
        {
          title: `Sort Ticket ${item.label}`,
          description: item.label,
          client_id: clientId,
          board_id: boardId,
          status_id: statusId,
          priority_id: priorityId,
          entered_by: actorId,
          assigned_to: item.assignedTo,
          assigned_team_id: item.teamId,
        } as any,
        tenantId,
        trx,
      ),
    );
    const ticketId = created.ticket_id!;
    await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).update({
      assigned_to: item.assignedTo,
      assigned_team_id: item.teamId,
      updated_at: new Date(item.updatedAt),
      entered_at: new Date(item.enteredAt),
    });
    seeded.push({
      ticketId,
      assignedTo: item.assignedTo,
      assignedName: item.assignedName,
      teamName: item.teamName,
      updatedAt: item.updatedAt,
    });
  }
}

const baseFilters: ITicketListFilters = {
  boardFilterState: 'all',
  statusId: TICKET_STATUS_FILTER_ALL,
  showOpenOnly: false,
  bundleView: 'individual',
};

function sortFilters(sortBy: string, sortDirection: 'asc' | 'desc'): ITicketListFilters {
  return { ...baseFilters, sortBy, sortDirection };
}

async function listIds(filters: ITicketListFilters): Promise<string[]> {
  const result = await optimized.getTicketsForList(filters, 1, 50);
  if (!('tickets' in (result as any))) {
    throw new Error(`ticket list returned an error: ${JSON.stringify(result)}`);
  }
  return (result as any).tickets.map((ticket: { ticket_id: string }) => ticket.ticket_id);
}

/**
 * Independent comparator mirroring the documented SQL semantics:
 *  - assigned_to_name compares the display name ('' for unassigned);
 *  - assigned_team_name compares the name with NULLs last ascending (Postgres
 *    default), so they are first descending;
 *  - updated_at compares timestamps;
 *  - ties always fall back to ticket_id DESC.
 */
function expectedOrder(sortBy: string, sortDirection: 'asc' | 'desc'): string[] {
  const rows = [...seeded];
  rows.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'assigned_to_name') {
      cmp = a.assignedName < b.assignedName ? -1 : a.assignedName > b.assignedName ? 1 : 0;
    } else if (sortBy === 'assigned_team_name') {
      const an = a.teamName;
      const bn = b.teamName;
      if (an === null && bn === null) cmp = 0;
      else if (an === null) cmp = 1;
      else if (bn === null) cmp = -1;
      else cmp = an < bn ? -1 : an > bn ? 1 : 0;
    } else {
      cmp = a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
    }
    if (cmp !== 0) return sortDirection === 'asc' ? cmp : -cmp;
    return a.ticketId < b.ticketId ? 1 : a.ticketId > b.ticketId ? -1 : 0;
  });
  return rows.map((row) => row.ticketId);
}

const SORT_KEYS = ['assigned_to_name', 'assigned_team_name', 'updated_at'] as const;
const DIRECTIONS = ['asc', 'desc'] as const;

describeDb('ticket list assignee/updated sorting (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
    optimized = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    await seedFixture();

    authMocks.hasPermission.mockResolvedValue(true);
    authMocks.tenant = tenantId;
    authMocks.user = { user_id: actorId, user_type: 'internal', tenant: tenantId };
  }, 300000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60000);

  for (const sortBy of SORT_KEYS) {
    for (const direction of DIRECTIONS) {
      it(`orders by ${sortBy} ${direction} with ticket_id as tie-breaker`, async () => {
        const ids = await listIds(sortFilters(sortBy, direction));

        expect(ids).toHaveLength(seeded.length);
        expect(ids).toEqual(expectedOrder(sortBy, direction));
      });
    }
  }

  for (const sortBy of SORT_KEYS) {
    for (const direction of DIRECTIONS) {
      it(`adjacent-ticket navigation matches the list for ${sortBy} ${direction}`, async () => {
        const order = expectedOrder(sortBy, direction);
        const filters = sortFilters(sortBy, direction);

        for (let index = 0; index < order.length; index += 1) {
          const result = await optimized.getAdjacentTicketIds(order[index], filters);
          expect(result.currentPosition).toBe(index + 1);
          expect(result.totalCount).toBe(order.length);
          expect(result.prevTicketId).toBe(index > 0 ? order[index - 1] : null);
          expect(result.nextTicketId).toBe(index < order.length - 1 ? order[index + 1] : null);
        }
      });
    }
  }
});
