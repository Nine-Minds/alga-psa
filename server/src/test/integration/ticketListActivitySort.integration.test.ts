import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { TicketModel } from '@shared/models/ticketModel';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';
import { silentTicketCreation } from '@alga-psa/shared/lib/tickets/ticketLifecycleEvents';

/**
 * DB-backed proof for the `latest_activity_at` ticket-list sort.
 *
 * The unit tests prove the key is accepted and mapped; only Postgres can prove
 * the expression means what the column claims. The fixture covers every branch
 * of TICKET_LATEST_ACTIVITY_SQL: staggered published comments, a soft-deleted
 * comment newer than everything (must not count), a scheduled comment newer
 * than everything (must not count), a ticket with no comments at all
 * (GREATEST falls back to updated_at/entered_at rather than sorting as NULL),
 * a ticket edited after its last comment (updated_at wins), and an exact tie
 * that has to fall through to ticket_id DESC.
 *
 * Everything runs under an active board filter, with a decoy ticket on another
 * board whose comment would otherwise take first place descending — a sort that
 * dropped the filter, or a filter that dropped the sort, both show up here.
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

type SeededComment = {
  createdAt: string;
  publishState: 'published' | 'scheduled';
  deleted: boolean;
};

type SeededTicket = {
  label: string;
  ticketId: string;
  enteredAt: string;
  updatedAt: string;
  comments: SeededComment[];
};

let db: Knex;
let tenantId: string;
let boardId: string;
let decoyBoardId: string;
let statusId: string;
let decoyStatusId: string;
let priorityId: string;
let clientId: string;
let actorId: string;
let seeded: SeededTicket[] = [];

type OptimizedActions = typeof import('@alga-psa/tickets/actions/optimizedTicketActions');
let optimized: OptimizedActions;

type TicketPlan = {
  label: string;
  boardId: 'main' | 'decoy';
  enteredAt: string;
  updatedAt: string;
  comments: SeededComment[];
};

const PLAN: TicketPlan[] = [
  // No comments at all: activity is the ticket's own newest timestamp.
  {
    label: 'no-comments',
    boardId: 'main',
    enteredAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comments: [],
  },
  // Exact tie with `no-comments` — only ticket_id DESC can separate them.
  {
    label: 'tie-no-comments',
    boardId: 'main',
    enteredAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comments: [],
  },
  // Two published comments: the newest one is the activity.
  {
    label: 'staggered-comments',
    boardId: 'main',
    enteredAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    comments: [
      { createdAt: '2026-01-05T00:00:00.000Z', publishState: 'published', deleted: false },
      { createdAt: '2026-01-07T00:00:00.000Z', publishState: 'published', deleted: false },
    ],
  },
  // A soft-deleted comment is newer than everything and must be ignored.
  {
    label: 'deleted-comment',
    boardId: 'main',
    enteredAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
    comments: [
      { createdAt: '2026-01-04T00:00:00.000Z', publishState: 'published', deleted: false },
      { createdAt: '2026-01-20T00:00:00.000Z', publishState: 'published', deleted: true },
    ],
  },
  // A comment queued for later must not float the ticket to the top today.
  {
    label: 'scheduled-comment',
    boardId: 'main',
    enteredAt: '2026-01-06T00:00:00.000Z',
    updatedAt: '2026-01-06T00:00:00.000Z',
    comments: [
      { createdAt: '2026-01-25T00:00:00.000Z', publishState: 'scheduled', deleted: false },
    ],
  },
  // Edited after the last comment: the ticket's own updated_at is the activity.
  {
    label: 'updated-after-comment',
    boardId: 'main',
    enteredAt: '2026-01-08T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    comments: [
      { createdAt: '2026-01-09T00:00:00.000Z', publishState: 'published', deleted: false },
    ],
  },
  // Off-filter: newest activity of all, and must never appear.
  {
    label: 'other-board',
    boardId: 'decoy',
    enteredAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    comments: [
      { createdAt: '2026-02-01T00:00:00.000Z', publishState: 'published', deleted: false },
    ],
  },
];

async function seedFixture(): Promise<void> {
  tenantId = uuidv4();
  boardId = uuidv4();
  decoyBoardId = uuidv4();
  statusId = uuidv4();
  decoyStatusId = uuidv4();
  priorityId = uuidv4();
  clientId = uuidv4();
  actorId = uuidv4();

  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Activity Tenant ${tenantId.slice(0, 8)}`,
    email: `activity-${tenantId.slice(0, 8)}@example.com`,
    product_code: 'psa',
  });

  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Activity Client',
    is_inactive: false,
  });

  await db('boards').insert([
    {
      tenant: tenantId,
      board_id: boardId,
      board_name: 'Activity Board',
      is_default: true,
      is_inactive: false,
    },
    {
      tenant: tenantId,
      board_id: decoyBoardId,
      board_name: 'Decoy Board',
      is_default: false,
      is_inactive: false,
    },
  ]);

  await db('users').insert({
    tenant: tenantId,
    user_id: actorId,
    username: 'activity-actor',
    hashed_password: 'not-used',
    email: 'activity-actor@example.com',
    first_name: 'Activity',
    last_name: 'Actor',
    user_type: 'internal',
    is_inactive: false,
  });

  await db('priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'High',
    created_by: actorId,
    order_number: 10,
  });

  await db('statuses').insert([
    {
      tenant: tenantId,
      status_id: statusId,
      board_id: boardId,
      name: 'Open',
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      created_by: actorId,
      order_number: 10,
    },
    {
      tenant: tenantId,
      status_id: decoyStatusId,
      board_id: decoyBoardId,
      name: 'Open',
      status_type: 'ticket',
      is_closed: false,
      is_default: false,
      created_by: actorId,
      order_number: 10,
    },
  ]);

  seeded = [];
  for (const item of PLAN) {
    const targetBoardId = item.boardId === 'main' ? boardId : decoyBoardId;
    const targetStatusId = item.boardId === 'main' ? statusId : decoyStatusId;
    const created = await db.transaction((trx) =>
      TicketModel.createTicket(
        {
          title: `Activity Ticket ${item.label}`,
          description: item.label,
          client_id: clientId,
          board_id: targetBoardId,
          status_id: targetStatusId,
          priority_id: priorityId,
          entered_by: actorId,
          assigned_to: actorId,
        } as any,
        tenantId,
        trx, {}, silentTicketCreation('test fixture'),
      ),
    );
    const ticketId = created.ticket_id!;

    for (const comment of item.comments) {
      const commentId = uuidv4();
      const threadId = uuidv4();
      const createdAt = new Date(comment.createdAt);
      await db('comment_threads').insert({
        tenant: tenantId,
        thread_id: threadId,
        ticket_id: ticketId,
        project_task_id: null,
        root_comment_id: commentId,
        is_internal: false,
        reply_count: 0,
        last_activity_at: createdAt,
        created_at: createdAt,
        created_by: actorId,
      });
      await db('comments').insert({
        tenant: tenantId,
        comment_id: commentId,
        ticket_id: ticketId,
        thread_id: threadId,
        user_id: actorId,
        author_type: 'internal',
        note: '[]',
        is_internal: false,
        is_resolution: false,
        publish_state: comment.publishState,
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: comment.deleted ? createdAt : null,
      });
    }

    // Written last: creating comments must not leave the ticket's own
    // timestamps where the fixture did not put them.
    await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).update({
      entered_at: new Date(item.enteredAt),
      updated_at: new Date(item.updatedAt),
    });

    if (item.boardId === 'main') {
      seeded.push({
        label: item.label,
        ticketId,
        enteredAt: item.enteredAt,
        updatedAt: item.updatedAt,
        comments: item.comments,
      });
    }
  }
}

/** Active board filter: the decoy ticket must be excluded from every result. */
const baseFilters: ITicketListFilters = {
  boardFilterState: 'all',
  statusId: TICKET_STATUS_FILTER_ALL,
  showOpenOnly: false,
  bundleView: 'individual',
};

function sortFilters(sortDirection: 'asc' | 'desc'): ITicketListFilters {
  return { ...baseFilters, boardIds: [boardId], sortBy: 'latest_activity_at', sortDirection };
}

async function listTickets(filters: ITicketListFilters) {
  const result = await optimized.getTicketsForList(filters, 1, 50);
  if (!('tickets' in (result as any))) {
    throw new Error(`ticket list returned an error: ${JSON.stringify(result)}`);
  }
  return (result as any).tickets as Array<{ ticket_id: string; latest_activity_at?: string | null }>;
}

/**
 * Independent comparator for the documented semantics: the newest of the
 * ticket's own timestamps and its newest comment that is both published and not
 * soft-deleted; ties fall back to ticket_id DESC.
 */
function expectedActivity(row: SeededTicket): string {
  const candidates = [row.enteredAt, row.updatedAt];
  for (const comment of row.comments) {
    if (comment.publishState !== 'published' || comment.deleted) continue;
    candidates.push(comment.createdAt);
  }
  return candidates.reduce((max, value) => (value > max ? value : max));
}

function expectedOrder(sortDirection: 'asc' | 'desc'): string[] {
  const rows = [...seeded];
  rows.sort((a, b) => {
    const av = expectedActivity(a);
    const bv = expectedActivity(b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    if (cmp !== 0) return sortDirection === 'asc' ? cmp : -cmp;
    return a.ticketId < b.ticketId ? 1 : a.ticketId > b.ticketId ? -1 : 0;
  });
  return rows.map((row) => row.ticketId);
}

const DIRECTIONS = ['asc', 'desc'] as const;

describeDb('ticket list latest-activity sorting (DB-backed)', () => {
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

  for (const direction of DIRECTIONS) {
    it(`orders by latest_activity_at ${direction} under an active board filter`, async () => {
      const tickets = await listTickets(sortFilters(direction));

      expect(tickets.map((ticket) => ticket.ticket_id)).toEqual(expectedOrder(direction));
    });
  }

  it('reports the same activity timestamp it sorted by', async () => {
    const tickets = await listTickets(sortFilters('desc'));
    const byId = new Map(tickets.map((ticket) => [ticket.ticket_id, ticket.latest_activity_at]));

    for (const row of seeded) {
      const actual = byId.get(row.ticketId);
      expect(actual, row.label).toBeTruthy();
      expect(new Date(actual as string).toISOString(), row.label).toBe(expectedActivity(row));
    }
  });

  it('ignores deleted and scheduled comments when ranking', async () => {
    const order = await listTickets(sortFilters('desc'));
    const labelOf = new Map(seeded.map((row) => [row.ticketId, row.label]));
    const labels = order.map((ticket) => labelOf.get(ticket.ticket_id));

    // The 2026-01-20 deleted comment and the 2026-01-25 scheduled comment are
    // the two newest timestamps in the fixture; counting either would put its
    // ticket first.
    expect(labels[0]).toBe('updated-after-comment');
    expect(labels.indexOf('deleted-comment')).toBeGreaterThan(labels.indexOf('scheduled-comment'));
  });

  for (const direction of DIRECTIONS) {
    it(`adjacent-ticket navigation matches the list for ${direction}`, async () => {
      const order = expectedOrder(direction);
      const filters = sortFilters(direction);

      for (let index = 0; index < order.length; index += 1) {
        const result = await optimized.getAdjacentTicketIds(order[index], filters);
        expect(result.currentPosition).toBe(index + 1);
        expect(result.totalCount).toBe(order.length);
        expect(result.prevTicketId).toBe(index > 0 ? order[index - 1] : null);
        expect(result.nextTicketId).toBe(index < order.length - 1 ? order[index + 1] : null);
      }
    });
  }
});
