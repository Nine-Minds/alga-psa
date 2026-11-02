import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';


/**
 * Behavioural coverage: a bundle that grants ticket:read but excludes the ticket from
 * update/delete scope must deny every ticket mutation route (403) without invoking the
 * service write, while GET still succeeds. The fake kernel below mimics bundle matching
 * on resource + action (as BundleAuthorizationKernelProvider does).
 */
const state = vi.hoisted(() => ({
  deniedActions: new Set<string>(),
  seenActions: [] as string[],
}));

const svc = vi.hoisted(() => ({
  update: vi.fn(async () => ({ ticket_id: 'x' })),
  delete: vi.fn(async () => undefined),
  addComment: vi.fn(async () => ({ comment_id: 'c' })),
  addWatcher: vi.fn(async () => []),
}));

vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({
    authorizeResource: vi.fn(async (input: any) => {
      state.seenActions.push(input.resource.action);
      return { allowed: !state.deniedActions.has(input.resource.action) };
    }),
  })),
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({
      tenant: '11111111-1111-1111-1111-111111111111',
      user_id: 'user-1',
      api_key_id: 'key-1',
    })),
    validateApiKeyForTenant: vi.fn(async () => ({
      tenant: '11111111-1111-1111-1111-111111111111',
      user_id: 'user-1',
      api_key_id: 'key-1',
    })),
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({
    user_id: 'user-1',
    user_type: 'internal',
    tenant: '11111111-1111-1111-1111-111111111111',
  })),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()),
  runWithApiKeyUser: vi.fn(async (_user: unknown, callback: () => Promise<any>) => callback()),
  tenantDb: vi.fn(() => ({ table: () => ({}) })),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => ({})),
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: vi.fn(async () => null),
  shouldBypassRateLimit: vi.fn(() => false),
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
}));

vi.mock('@/lib/productSurfaceRegistry', () => ({
  resolveProductApiBehavior: vi.fn(() => 'allowed'),
}));

vi.mock('../../../lib/api/services/TicketService', () => ({
  TicketService: class {
    update = svc.update;
    delete = svc.delete;
    addComment = svc.addComment;
    addWatcher = svc.addWatcher;
    async getById() {
      return {
        ticket_id: '22222222-2222-2222-2222-222222222222',
        assigned_to: null,
        entered_by: null,
        client_id: null,
        board_id: null,
        status_id: null,
      };
    }
  },
}));

import { GET, PUT, DELETE } from '../../../app/api/v1/tickets/[id]/route';
import { POST as commentPOST } from '../../../app/api/v1/tickets/[id]/comments/route';
import { POST as watcherPOST } from '../../../app/api/v1/tickets/[id]/watchers/route';

const TICKET = '22222222-2222-2222-2222-222222222222';
const headers = { 'x-api-key': 'test-api-key', 'content-type': 'application/json' };
const url = (suffix = '') => `http://localhost/api/v1/tickets/${TICKET}${suffix}`;
const ctx = { params: Promise.resolve({ id: TICKET }) };

const req = (method: string, suffix = '', body?: unknown) =>
  new NextRequest(url(suffix), { method, headers, body: body ? JSON.stringify(body) : undefined });

describe('ticket mutations are authorized against update/delete scope, not read', () => {
  beforeEach(() => {
    state.deniedActions = new Set();
    state.seenActions = [];
    Object.values(svc).forEach((m) => m.mockClear());
  });

  it('bundle excluding update: GET 200, PUT/comment/watcher 403, no writes', async () => {
    state.deniedActions = new Set(['update']);

    expect((await GET(req('GET'), ctx as any)).status).toBe(200);
    expect((await PUT(req('PUT', '', { title: 'x' }), ctx as any)).status).toBe(403);
    expect((await commentPOST(req('POST', '/comments', { comment_text: 'hi' }), ctx as any)).status).toBe(403);
    expect(
      (await watcherPOST(req('POST', '/watchers', { watch_type: 'user', user_id: TICKET }), ctx as any)).status
    ).toBe(403);

    expect(svc.update).not.toHaveBeenCalled();
    expect(svc.addComment).not.toHaveBeenCalled();
    expect(svc.addWatcher).not.toHaveBeenCalled();
  });

  it('bundle excluding delete: DELETE 403, no write', async () => {
    state.deniedActions = new Set(['delete']);
    expect((await DELETE(req('DELETE'), ctx as any)).status).toBe(403);
    expect(svc.delete).not.toHaveBeenCalled();
    expect(state.seenActions).toContain('delete');
  });

  it('bundle permitting update lets the PUT through (update action was evaluated)', async () => {
    state.deniedActions = new Set(['delete']);
    expect((await PUT(req('PUT', '', { title: 'x' }), ctx as any)).status).toBe(200);
    expect(svc.update).toHaveBeenCalledTimes(1);
    expect(state.seenActions).toContain('update');
  });

  it('with no update rule at all the PUT and DELETE stay allowed (default unchanged)', async () => {
    expect((await PUT(req('PUT', '', { title: 'x' }), ctx as any)).status).toBe(200);
    expect((await DELETE(req('DELETE'), ctx as any)).status).toBe(204);
  });

  it('read denial still blocks mutation (404/403 semantics preserved)', async () => {
    state.deniedActions = new Set(['read']);
    expect((await PUT(req('PUT', '', { title: 'x' }), ctx as any)).status).toBe(403);
    expect(svc.update).not.toHaveBeenCalled();
  });
});
