import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * PUT /api/v1/tickets/{id}/assignment must ask the authorization kernel for an `update`
 * decision on the ticket (not only `read`), and enforce it inside TicketService.update's
 * transaction. The spy test pins the original defect: only a `read` decision was made.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const IN_SCOPE = '22222222-2222-2222-2222-222222222222';
const OUT_OF_SCOPE = '33333333-3333-3333-3333-333333333333';

const state = vi.hoisted(() => ({
  tickets: {} as Record<string, Record<string, unknown>>,
  // Bundle simulation: `update` is narrowed to this board (relation X); read is unrestricted unless listed.
  updateBoards: new Set<string>(),
  readDenied: new Set<string>(),
  writes: [] as string[],
}));

const authorizeResourceMock = vi.hoisted(() =>
  vi.fn(async ({ resource, record }: { resource: { type: string; action: string }; record: { id: string; boardId?: string } }) => {
    if (resource.action === 'update') {
      return { allowed: state.updateBoards.has(record.boardId ?? '') };
    }
    if (resource.action === 'read') {
      return { allowed: !state.readDenied.has(record.id) };
    }
    return { allowed: false };
  })
);

const serviceUpdateMock = vi.hoisted(() =>
  vi.fn(async (id: string, data: Record<string, unknown>, _ctx: unknown, options?: { authorize?: (t: any, trx: any) => Promise<void> }) => {
    const row = state.tickets[id];
    if (options?.authorize) await options.authorize(row, {});
    state.writes.push(id);
    return { ...row, ...data };
  })
);

const removeTicketAgentMock = vi.hoisted(() => vi.fn(async () => undefined));
const addWatcherMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
    validateApiKeyForTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
  },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ user_id: 'user-1', user_type: 'internal', tenant: TENANT })),
}));
vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_t: string, cb: () => Promise<any>) => cb()),
  runWithApiKeyUser: vi.fn(async (_u: unknown, cb: () => Promise<any>) => cb()),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@/lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: vi.fn(async () => null),
  shouldBypassRateLimit: vi.fn(() => false),
}));
vi.mock('@/lib/productAccess', () => ({ getTenantProduct: vi.fn(async () => 'psa') }));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: vi.fn(() => 'allowed') }));
vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({ authorizeResource: authorizeResourceMock })),
}));
vi.mock('../../../lib/api/services/TicketService', () => ({
  TicketService: class {
    getById = vi.fn(async (id: string) => state.tickets[id] ?? null);
    update = serviceUpdateMock;
    removeTicketAgent = removeTicketAgentMock;
    addWatcher = addWatcherMock;
  },
}));

import { PUT } from '../../../app/api/v1/tickets/[id]/assignment/route';
import { POST as POST_WATCHER } from '../../../app/api/v1/tickets/[id]/watchers/route';
import { DELETE as DELETE_AGENT } from '../../../app/api/v1/tickets/[id]/agents/[userId]/route';

const AGENT_USER = '55555555-5555-4555-8555-555555555555';
const deleteAgent = (ticketId: string) =>
  DELETE_AGENT(
    new NextRequest(`http://localhost/api/v1/tickets/${ticketId}/agents/${AGENT_USER}`, {
      method: 'DELETE',
      headers: { 'x-api-key': 'k' },
    }),
    { params: Promise.resolve({ id: ticketId, userId: AGENT_USER }) } as any
  );

const put = (ticketId: string) =>
  PUT(
    new NextRequest(`http://localhost/api/v1/tickets/${ticketId}/assignment`, {
      method: 'PUT',
      headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ assigned_to: '44444444-4444-4444-4444-444444444444' }),
    }),
    { params: Promise.resolve({ id: ticketId }) } as any
  );

const actionsRequested = () =>
  authorizeResourceMock.mock.calls.map(([a]) => `${a.resource.type}:${a.resource.action}`);

describe('PUT /api/v1/tickets/{id}/assignment authorization', () => {
  beforeEach(() => {
    state.tickets = {
      [IN_SCOPE]: { ticket_id: IN_SCOPE, board_id: 'board-x', client_id: 'c1', assigned_to: null, status_id: 's1' },
      [OUT_OF_SCOPE]: { ticket_id: OUT_OF_SCOPE, board_id: 'board-y', client_id: 'c1', assigned_to: null, status_id: 's1' },
    };
    state.updateBoards = new Set(['board-x']);
    state.readDenied = new Set();
    state.writes = [];
    authorizeResourceMock.mockClear();
    serviceUpdateMock.mockClear();
  });

  it('makes a ticket `update` decision in the kernel, not only `read`', async () => {
    const res = await put(IN_SCOPE);
    expect(res.status).toBe(200);
    expect(authorizeResourceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: { type: 'ticket', action: 'update' },
        record: expect.objectContaining({ id: IN_SCOPE }),
      })
    );
  });

  it('403s and writes nothing for a readable ticket outside the update scope', async () => {
    const res = await put(OUT_OF_SCOPE);
    expect(res.status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  it('200s for a ticket inside the update scope', async () => {
    const res = await put(IN_SCOPE);
    expect(res.status).toBe(200);
    expect(state.writes).toEqual([IN_SCOPE]);
  });

  it('403s when update is allowed but read is denied (no record disclosure)', async () => {
    state.readDenied = new Set([IN_SCOPE]);
    const res = await put(IN_SCOPE);
    expect(res.status).toBe(403);
    expect(state.writes).toEqual([]);
    expect(actionsRequested()).toContain('ticket:update');
  });

  it('passes an in-transaction authorize hook that re-checks the locked row', async () => {
    await put(IN_SCOPE);
    const options = serviceUpdateMock.mock.calls[0][3] as { authorize?: unknown } | undefined;
    expect(typeof options?.authorize).toBe('function');

    // The row changed between the pre-check and the lock: the hook decides on the locked row.
    state.tickets[IN_SCOPE] = { ...state.tickets[IN_SCOPE], board_id: 'board-y' };
    state.writes = [];
    const res = await put(IN_SCOPE);
    expect(res.status).toBe(403);
    expect(state.writes).toEqual([]);
  });

  describe('Disclosure arm: read is required only where the response discloses the ticket', () => {
    beforeEach(() => {
      // Caller holds ticket:update scope on this ticket but no ticket:read scope.
      state.readDenied = new Set([IN_SCOPE]);
      removeTicketAgentMock.mockClear();
      addWatcherMock.mockClear();
    });

    it('(a) an update-allowed / read-denied caller may use an acknowledgement-only mutation (DELETE agents/{userId}, 204)', async () => {
      const res = await deleteAgent(IN_SCOPE);
      expect(res.status).toBe(204);
      expect(removeTicketAgentMock).toHaveBeenCalledTimes(1);
      expect(actionsRequested()).toContain('ticket:update');
      expect(actionsRequested()).not.toContain('ticket:read');
    });

    it('(b) the same caller gets 403 on PUT assignment (response discloses the ticket) and nothing is written', async () => {
      const res = await put(IN_SCOPE);
      expect(res.status).toBe(403);
      expect(serviceUpdateMock).not.toHaveBeenCalled();
      expect(state.writes).toEqual([]);
      expect(actionsRequested()).toEqual(expect.arrayContaining(['ticket:update', 'ticket:read']));
    });

    it('(c) the same caller gets 403 on POST watchers (response returns the watcher list) and addWatcher is not called', async () => {
      const res = await POST_WATCHER(
        new NextRequest(`http://localhost/api/v1/tickets/${IN_SCOPE}/watchers`, {
          method: 'POST',
          headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'throwaway@example.com' }),
        }),
        { params: Promise.resolve({ id: IN_SCOPE }) } as any
      );
      expect(res.status).toBe(403);
      expect(addWatcherMock).not.toHaveBeenCalled();
      expect(actionsRequested()).toEqual(expect.arrayContaining(['ticket:update', 'ticket:read']));
    });
  });
});
