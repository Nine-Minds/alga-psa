import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import { TICKET_WHERE_MAX_TICKET_IDS } from '@alga-psa/tickets/lib/ticketWhere';
import type { ITicketListFilters } from '@alga-psa/types';

/**
 * T005: counts-only recovery (`getTicketChangeCounts`) returns the ids of new tickets so the banner's
 * "N new tickets" link can focus on them. Only tickets that are readable by the caller, match the list's
 * filters, are not on the loaded page and were changed by someone else after the cutoff are returned;
 * the list is capped at the `ticket_id` where-cap while `newCount` keeps the true total.
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
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) =>
    action(authMocks.user, { tenant: authMocks.tenant }, ...args),
  hasPermission: (...args: any[]) => authMocks.hasPermission(...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: any[]) => authMocks.hasPermission(...args) }));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getEntityImageUrlsBatch: vi.fn().mockResolvedValue(new Map()),
}));

const describeDb = await describeWithDb();

type OptimizedActions = typeof import('@alga-psa/tickets/actions/optimizedTicketActions');
let optimized: OptimizedActions;
let db: Knex;

let tenantId: string;
let me: string;
let other: string;
let boardId: string;
let otherBoardId: string;
let statusId: string;
let otherStatusId: string;
let priorityId: string;
let clientId: string;
let seq = 0;

const CUTOFF = Date.now() - 60 * 60 * 1000;
const after = () => new Date(CUTOFF + 5 * 60 * 1000);

const filters: ITicketListFilters = {
  boardFilterState: 'all', statusId: TICKET_STATUS_FILTER_ALL, showOpenOnly: false, bundleView: 'individual',
};

async function insertTicket(fields: Record<string, unknown> = {}): Promise<string> {
  seq += 1;
  const ticketId = uuidv4();
  await db('tickets').insert({
    tenant: tenantId, ticket_id: ticketId, ticket_number: `NT-${seq}-${ticketId.slice(0, 6)}`, title: `Ticket ${seq}`,
    board_id: boardId, status_id: statusId, priority_id: priorityId, client_id: clientId, entered_by: me,
    entered_at: new Date(CUTOFF - 24 * 3600 * 1000), updated_at: after(), updated_by: other,
    ...fields,
  });
  return ticketId;
}

async function counts(loaded: string[] = [], scope: Partial<ITicketListFilters> = {}) {
  const result = await optimized.getTicketChangeCounts({ ...filters, ...scope }, loaded, CUTOFF);
  if ('actionError' in (result as any) || !('newTicketIds' in (result as any))) throw new Error(`unexpected: ${JSON.stringify(result)}`);
  return result as Awaited<ReturnType<OptimizedActions['getTicketChangeCounts']>> & { newTicketIds: string[]; newCount: number; updatedCount: number };
}

describeDb('getTicketChangeCounts newTicketIds (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: false });
    optimized = await import('@alga-psa/tickets/actions/optimizedTicketActions');

    tenantId = uuidv4();
    me = uuidv4();
    other = uuidv4();
    await db('tenants').insert({ tenant: tenantId, client_name: `NewIds ${tenantId.slice(0, 8)}`, email: `newids-${tenantId.slice(0, 8)}@example.com`, product_code: 'psa' });
    const user = (id: string, name: string) => ({
      tenant: tenantId, user_id: id, username: `${name}-${id.slice(0, 8)}`, hashed_password: 'not-used',
      email: `${name}-${id.slice(0, 8)}@example.com`, first_name: name, last_name: 'NewIds', user_type: 'internal', is_inactive: false, timezone: 'UTC',
    });
    await db('users').insert([user(me, 'Me'), user(other, 'Other')]);
    boardId = uuidv4();
    otherBoardId = uuidv4();
    await db('boards').insert([
      { tenant: tenantId, board_id: boardId, board_name: 'Main', is_default: true, is_inactive: false },
      { tenant: tenantId, board_id: otherBoardId, board_name: 'Elsewhere', is_default: false, is_inactive: false },
    ]);
    statusId = uuidv4();
    otherStatusId = uuidv4();
    const status = (id: string, board: string) => ({
      tenant: tenantId, status_id: id, board_id: board, name: 'Open', status_type: 'ticket', is_closed: false, is_default: false, created_by: me, order_number: 10,
    });
    await db('statuses').insert([status(statusId, boardId), status(otherStatusId, otherBoardId)]);
    priorityId = uuidv4();
    await db('priorities').insert({ tenant: tenantId, priority_id: priorityId, priority_name: 'High', created_by: me, order_number: 10 });

    clientId = uuidv4();
    await db('clients').insert({ tenant: tenantId, client_id: clientId, client_name: 'Client', is_inactive: false });

    authMocks.hasPermission.mockImplementation(async () => true);
    authMocks.tenant = tenantId;
    authMocks.user = { user_id: me, user_type: 'internal', tenant: tenantId };
  }, 300000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60000);

  it('returns the ids of matching tickets changed by someone else after the cutoff, and not the caller\'s own or loaded ones', async () => {
    const fresh = await insertTicket();
    const own = await insertTicket({ updated_by: me });
    const stale = await insertTicket({ updated_at: new Date(CUTOFF - 10 * 60 * 1000) });
    const loaded = await insertTicket();
    const otherBoard = await insertTicket({ board_id: otherBoardId, status_id: otherStatusId });

    const result = await counts([loaded], { boardIds: [boardId] });
    expect(result.newTicketIds).toContain(fresh);
    expect(result.newTicketIds).not.toContain(own);
    expect(result.newTicketIds).not.toContain(stale);
    expect(result.newTicketIds).not.toContain(loaded);
    // Outside the list's own board filter: not part of the matching set, so never revealed.
    expect(result.newTicketIds).not.toContain(otherBoard);
    expect(result.newTicketIds).toHaveLength(result.newCount);
    expect(result.loadedChanged).toEqual([true]);
  });

  it('caps newTicketIds at the ticket_id where-cap while newCount stays the true total', async () => {
    const batchBoard = uuidv4();
    await db('boards').insert({ tenant: tenantId, board_id: batchBoard, board_name: 'Batch', is_default: false, is_inactive: false });
    const batchStatus = uuidv4();
    await db('statuses').insert({
      tenant: tenantId, status_id: batchStatus, board_id: batchBoard, name: 'Open', status_type: 'ticket', is_closed: false, is_default: false, created_by: me, order_number: 10,
    });
    const total = TICKET_WHERE_MAX_TICKET_IDS + 7;
    const now = Date.now();
    await db('tickets').insert(Array.from({ length: total }, (_, i) => ({
      tenant: tenantId, ticket_id: uuidv4(), ticket_number: `CAP-${now}-${i}`, title: `Cap ${i}`, board_id: batchBoard, status_id: batchStatus,
      priority_id: priorityId, client_id: clientId, entered_by: me, entered_at: new Date(CUTOFF - 24 * 3600 * 1000), updated_at: after(), updated_by: other,
    })));

    const result = await counts([], { boardIds: [batchBoard] });
    expect(result.newCount).toBe(total);
    expect(result.newTicketIds).toHaveLength(TICKET_WHERE_MAX_TICKET_IDS);
    expect(new Set(result.newTicketIds).size).toBe(TICKET_WHERE_MAX_TICKET_IDS);
  });
});
