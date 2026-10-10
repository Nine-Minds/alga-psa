/**
 * `GET /api/v1/tickets` must agree with the web ticket list about "last
 * activity", and must not leak internal-note timing to the client portal.
 *
 * The API list is a separate code path (TicketService.list) from the web list
 * (getTicketsForList), so the only thing that proves they agree is running both
 * against the same rows. The fixture covers every branch of the activity
 * expression: staggered published comments, a soft-deleted comment newer than
 * everything, a comment scheduled for later, a ticket with no comments at all,
 * a ticket edited after its last comment, and an exact tie that only the
 * ticket_id tie-break can separate.
 *
 * Real-DB integration test (mirrors assetTicketCategoryApi): a mocked getKnex
 * injects the test connection into the service, while the web list reads the
 * DB_* env that createTestDbConnection points at the same database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { TicketService } from '@/lib/api/services/TicketService';

const HOOK_TIMEOUT = 300_000;

const authMocks = vi.hoisted(() => ({
  user: null as any,
  tenant: null as string | null,
  hasPermission: vi.fn(),
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
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getEntityImageUrlsBatch: vi.fn().mockResolvedValue(new Map()),
}));

type SeededComment = {
  createdAt: string;
  publishState: 'published' | 'scheduled';
  deleted: boolean;
  isInternal?: boolean;
};

type TicketPlan = {
  label: string;
  enteredAt: string;
  updatedAt: string;
  /**
   * Attributes the ticket to the portal contact, the way a portal-raised ticket
   * looks. The portal caller here has client scope, so every seeded ticket is
   * visible either way — this only keeps the fixture realistic.
   */
  ownedByContact?: boolean;
  comments: SeededComment[];
};

const PLAN: TicketPlan[] = [
  // No comments at all: activity is the ticket's own newest timestamp.
  {
    label: 'no-comments',
    enteredAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comments: [],
  },
  // Exact tie with `no-comments` — only ticket_id DESC can separate them.
  {
    label: 'tie-no-comments',
    enteredAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comments: [],
  },
  // Two published comments: the newest one is the activity.
  {
    label: 'staggered-comments',
    enteredAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    comments: [
      { createdAt: '2026-01-05T00:00:00.000Z', publishState: 'published', deleted: false },
      { createdAt: '2026-01-07T00:00:00.000Z', publishState: 'published', deleted: false },
    ],
  },
  // A soft-deleted comment newer than everything must be ignored.
  {
    label: 'deleted-comment',
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
    enteredAt: '2026-01-06T00:00:00.000Z',
    updatedAt: '2026-01-06T00:00:00.000Z',
    comments: [
      { createdAt: '2026-01-25T00:00:00.000Z', publishState: 'scheduled', deleted: false },
    ],
  },
  // Edited after its last comment: the ticket's own updated_at is the activity.
  {
    label: 'updated-after-comment',
    enteredAt: '2026-01-08T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    comments: [
      { createdAt: '2026-01-09T00:00:00.000Z', publishState: 'published', deleted: false },
    ],
  },
  // The portal leak case: an internal note is the newest activity in the whole
  // fixture, while the newest client-visible activity is old enough to rank
  // second-to-last. Counting the note would both change the reported value and
  // move this ticket to the front of the portal list.
  {
    label: 'internal-note-newest',
    enteredAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ownedByContact: true,
    comments: [
      { createdAt: '2026-01-03T00:00:00.000Z', publishState: 'published', deleted: false },
      {
        createdAt: '2026-01-26T00:00:00.000Z',
        publishState: 'published',
        deleted: false,
        isInternal: true,
      },
    ],
  },
];

type SeededTicket = TicketPlan & { ticketId: string };

let db: Knex;
let tenantId: string;
let userId: string;
let portalUserId: string;
let clientId: string;
let contactId: string;
let boardId: string;
let statusId: string;
let priorityId: string;
let seeded: SeededTicket[] = [];

type OptimizedActions = typeof import('@alga-psa/tickets/actions/optimizedTicketActions');
let optimized: OptimizedActions;

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

function unscoped(table: string, reason: string) {
  return tenantDb(db, '__test_fixture__').unscoped(table, reason);
}

async function seedFixture(): Promise<void> {
  tenantId = uuidv4();
  userId = uuidv4();
  portalUserId = uuidv4();
  clientId = uuidv4();
  contactId = uuidv4();
  boardId = uuidv4();
  statusId = uuidv4();
  priorityId = uuidv4();

  await unscoped('tenants', 'test fixture creates and removes tenant rows').insert({
    tenant: tenantId,
    client_name: `Activity Tenant ${tenantId.slice(0, 8)}`,
    email: `activity-${tenantId.slice(0, 8)}@example.com`,
    product_code: 'psa',
  });

  await tenantTable('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Activity Client',
    is_inactive: false,
  });

  await tenantTable('boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Activity Board',
    is_default: true,
    is_inactive: false,
    client_portal_visible: true,
  });

  await tenantTable('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: 'Portal Contact',
    email: `portal-${tenantId.slice(0, 8)}@example.com`,
    client_id: clientId,
    is_inactive: false,
  });

  await tenantTable('users').insert([
    {
      tenant: tenantId,
      user_id: userId,
      username: `activity-actor-${tenantId.slice(0, 8)}`,
      hashed_password: 'not-used',
      email: `activity-actor-${tenantId.slice(0, 8)}@example.com`,
      first_name: 'Activity',
      last_name: 'Actor',
      user_type: 'internal',
      is_inactive: false,
    },
    {
      tenant: tenantId,
      user_id: portalUserId,
      username: `activity-portal-${tenantId.slice(0, 8)}`,
      hashed_password: 'not-used',
      email: `activity-portal-${tenantId.slice(0, 8)}@example.com`,
      first_name: 'Portal',
      last_name: 'Contact',
      user_type: 'client',
      contact_id: contactId,
      is_inactive: false,
    },
  ]);

  await tenantTable('priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'High',
    created_by: userId,
    order_number: 10,
    item_type: 'ticket',
  });

  await tenantTable('statuses').insert({
    tenant: tenantId,
    status_id: statusId,
    board_id: boardId,
    name: 'Open',
    status_type: 'ticket',
    is_closed: false,
    is_default: true,
    created_by: userId,
    order_number: 10,
  });

  seeded = [];
  for (const [index, item] of PLAN.entries()) {
    const ticketId = uuidv4();

    await tenantTable('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `ACT-${tenantId.slice(0, 8)}-${index}`,
      title: `Activity Ticket ${item.label}`,
      client_id: clientId,
      contact_name_id: item.ownedByContact ? contactId : null,
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      entered_by: userId,
      assigned_to: userId,
      is_closed: false,
      entered_at: new Date(item.enteredAt),
      updated_at: new Date(item.updatedAt),
    });

    for (const comment of item.comments) {
      const commentId = uuidv4();
      const threadId = uuidv4();
      const createdAt = new Date(comment.createdAt);
      await tenantTable('comment_threads').insert({
        tenant: tenantId,
        thread_id: threadId,
        ticket_id: ticketId,
        project_task_id: null,
        root_comment_id: commentId,
        is_internal: comment.isInternal === true,
        reply_count: 0,
        last_activity_at: createdAt,
        created_at: createdAt,
        created_by: userId,
      });
      await tenantTable('comments').insert({
        tenant: tenantId,
        comment_id: commentId,
        ticket_id: ticketId,
        thread_id: threadId,
        user_id: userId,
        author_type: 'internal',
        note: '[]',
        is_internal: comment.isInternal === true,
        is_resolution: false,
        publish_state: comment.publishState,
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: comment.deleted ? createdAt : null,
      });
    }

    // Written last: inserting comments must not leave the ticket's own
    // timestamps anywhere but where the fixture put them.
    await tenantTable('tickets').where({ ticket_id: ticketId }).update({
      entered_at: new Date(item.enteredAt),
      updated_at: new Date(item.updatedAt),
    });

    seeded.push({ ...item, ticketId });
  }
}

async function cleanupFixture(): Promise<void> {
  if (!tenantId) return;
  await tenantTable('comments').del();
  await tenantTable('comment_threads').del();
  await tenantTable('tickets').del();
  await tenantTable('statuses').del();
  await tenantTable('priorities').del();
  await tenantTable('contacts').del();
  await tenantTable('users').del();
  await tenantTable('boards').del();
  await tenantTable('clients').del();
  await unscoped('tenants', 'test fixture creates and removes tenant rows')
    .where({ tenant: tenantId })
    .del();
}

/**
 * Independent comparator for the documented semantics: the newest of the
 * ticket's own timestamps and its newest comment that is published and not
 * soft-deleted. `publicOnly` additionally drops internal comments, which is what
 * a client-portal caller is allowed to see.
 */
function expectedActivity(row: SeededTicket, publicOnly = false): string {
  const candidates = [row.enteredAt, row.updatedAt];
  for (const comment of row.comments) {
    if (comment.publishState !== 'published' || comment.deleted) continue;
    if (publicOnly && comment.isInternal) continue;
    candidates.push(comment.createdAt);
  }
  return candidates.reduce((max, value) => (value > max ? value : max));
}

function expectedOrder(direction: 'asc' | 'desc', rows: SeededTicket[], publicOnly = false): string[] {
  return [...rows]
    .sort((a, b) => {
      const av = expectedActivity(a, publicOnly);
      const bv = expectedActivity(b, publicOnly);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
      // Tie-break is always ticket_id DESC, in both directions.
      return a.ticketId < b.ticketId ? 1 : a.ticketId > b.ticketId ? -1 : 0;
    })
    .map((row) => row.ticketId);
}

function apiService(): TicketService {
  const service = new TicketService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

const internalContext = () => ({
  tenant: tenantId,
  userId,
  user: { user_id: userId, user_type: 'internal', tenant: tenantId },
  db,
});

const portalContext = () => ({
  tenant: tenantId,
  userId: portalUserId,
  user: {
    user_id: portalUserId,
    user_type: 'client',
    contact_id: contactId,
    clientId,
    tenant: tenantId,
  },
  db,
});

function webListFilters(direction: 'asc' | 'desc'): ITicketListFilters {
  return {
    boardFilterState: 'all',
    statusId: TICKET_STATUS_FILTER_ALL,
    showOpenOnly: false,
    bundleView: 'individual',
    boardIds: [boardId],
    sortBy: 'latest_activity_at',
    sortDirection: direction,
  };
}

async function webList(direction: 'asc' | 'desc') {
  const result = await optimized.getTicketsForList(webListFilters(direction), 1, 50);
  if (!('tickets' in (result as any))) {
    throw new Error(`web ticket list returned an error: ${JSON.stringify(result)}`);
  }
  return (result as any).tickets as Array<{ ticket_id: string; latest_activity_at?: string | null }>;
}

const DIRECTIONS = ['asc', 'desc'] as const;

describe('ticket list latest_activity_at over the REST API', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    db = await createTestDbConnection({ runSeeds: false });
    optimized = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    await seedFixture();

    authMocks.hasPermission.mockResolvedValue(true);
    authMocks.tenant = tenantId;
    authMocks.user = { user_id: userId, user_type: 'internal', tenant: tenantId };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await cleanupFixture().catch(() => undefined);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  for (const direction of DIRECTIONS) {
    it(`orders by latest_activity_at ${direction} exactly like the web list`, async () => {
      const api = await apiService().list(
        { sort: 'latest_activity_at', order: direction, limit: 50 },
        internalContext() as any,
      );
      const apiOrder = api.data.map((ticket: any) => ticket.ticket_id);

      expect(apiOrder).toEqual(expectedOrder(direction, seeded));
      // The web list is the contract this endpoint is catching up with: same
      // rows, same order, including the ticket_id tie-break.
      expect(apiOrder).toEqual((await webList(direction)).map((ticket) => ticket.ticket_id));
    }, HOOK_TIMEOUT);
  }

  it('reports latest_activity_at as an ISO string in the default payload', async () => {
    const api = await apiService().list(
      { sort: 'latest_activity_at', order: 'desc', limit: 50 },
      internalContext() as any,
    );

    for (const row of seeded) {
      const returned = api.data.find((ticket: any) => ticket.ticket_id === row.ticketId) as any;
      expect(returned, row.label).toBeTruthy();
      expect(typeof returned.latest_activity_at, row.label).toBe('string');
      expect(returned.latest_activity_at, row.label).toBe(expectedActivity(row));
    }
  }, HOOK_TIMEOUT);

  it('returns latest_activity_at when requested through fields', async () => {
    const api = await apiService().list(
      { fields: ['ticket_id', 'latest_activity_at'], sort: 'latest_activity_at', order: 'desc', limit: 50 },
      internalContext() as any,
    );

    const byId = new Map(api.data.map((ticket: any) => [ticket.ticket_id, ticket.latest_activity_at]));
    for (const row of seeded) {
      expect(byId.get(row.ticketId), row.label).toBe(expectedActivity(row));
    }
  }, HOOK_TIMEOUT);

  it('rejects an unknown sort value with a 400 instead of a database error', async () => {
    await expect(
      apiService().list({ sort: 'not_a_column' }, internalContext() as any),
    ).rejects.toMatchObject({ statusCode: 400 });
  }, HOOK_TIMEOUT);

  it('keeps created_at working as an alias for entered_at', async () => {
    const aliased = await apiService().list(
      { sort: 'created_at', order: 'desc', limit: 50 },
      internalContext() as any,
    );
    const direct = await apiService().list(
      { sort: 'entered_at', order: 'desc', limit: 50 },
      internalContext() as any,
    );

    expect(aliased.data.map((t: any) => t.ticket_id)).toEqual(
      direct.data.map((t: any) => t.ticket_id),
    );
  }, HOOK_TIMEOUT);

  describe('client portal caller', () => {
    it('never reports an internal note as the latest activity', async () => {
      const portal = await apiService().list(
        { sort: 'latest_activity_at', order: 'desc', limit: 50 },
        portalContext() as any,
      );

      const leaky = seeded.find((row) => row.label === 'internal-note-newest')!;
      const returned = portal.data.find((ticket: any) => ticket.ticket_id === leaky.ticketId) as any;
      expect(returned).toBeTruthy();

      // The internal note is the newest row in the whole fixture; the portal
      // value must fall back to the newest client-visible activity.
      expect(returned.latest_activity_at).toBe(expectedActivity(leaky, true));
      expect(returned.latest_activity_at).not.toBe(expectedActivity(leaky));

      const internalView = await apiService().list(
        { sort: 'latest_activity_at', order: 'desc', limit: 50 },
        internalContext() as any,
      );
      const agentValue = (internalView.data.find(
        (ticket: any) => ticket.ticket_id === leaky.ticketId,
      ) as any).latest_activity_at;
      // Agents still see the internal note as activity.
      expect(agentValue).toBe(expectedActivity(leaky));
    }, HOOK_TIMEOUT);

    for (const direction of DIRECTIONS) {
      it(`does not let an internal note reorder the portal list (${direction})`, async () => {
        const portal = await apiService().list(
          { sort: 'latest_activity_at', order: direction, limit: 50 },
          portalContext() as any,
        );

        expect(portal.data.map((ticket: any) => ticket.ticket_id)).toEqual(
          expectedOrder(direction, seeded, true),
        );
      }, HOOK_TIMEOUT);
    }
  });
});
