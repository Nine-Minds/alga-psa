/**
 * /api/v1/boards write policy: same as the board server actions - an internal
 * principal holding ticket_settings:<action>. ticket:* alone is not enough.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  granted: new Set<string>(),
  userType: 'internal',
  body: {} as unknown,
  serviceCalls: [] as string[],
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
  ProductAccessError: class extends Error {},
}));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: () => 'allowed' }));
vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (_u: unknown, resource: string, action: string) =>
    state.granted.has(`${resource}:${action}`)
  ),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/api/services/BoardService', () => ({
  BoardService: class {
    async create(data: unknown) { state.serviceCalls.push('create'); return { board_id: 'b1', ...(data as object) }; }
    async update(id: string, data: unknown) { state.serviceCalls.push('update'); return { board_id: id, ...(data as object) }; }
    async delete() { state.serviceCalls.push('delete'); }
    async getById() { return { board_id: 'b1' }; }
    async list() { return { data: [], total: 0 }; }
  },
}));

const { ApiBoardController } = await import('@/lib/api/controllers/ApiBoardController');

const B = '6f1c2b1e-0b57-4a53-9d77-2f0f4d9f1a11';

function makeController() {
  const c: any = new ApiBoardController();
  // Skip API-key lookup: the request context is what authenticate() would have built.
  c.authenticate = async (req: any) => {
    req.context = {
      userId: 'u1',
      tenant: 't1',
      user: { user_id: 'u1', user_type: state.userType },
    };
    return req;
  };
  c.runWithApiKeyContext = async (_req: unknown, fn: () => Promise<unknown>) => fn();
  c.extractIdFromPath = async () => B;
  return c;
}

const request = (method: string, body?: unknown) =>
  new Request(`http://x/api/v1/boards/${B}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  }) as any;

describe('ApiBoardController write policy', () => {
  beforeEach(() => {
    state.granted = new Set();
    state.userType = 'internal';
    state.serviceCalls = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('403s create/update/delete for a caller holding ticket:* but not ticket_settings:*', async () => {
    state.granted = new Set(['ticket:create', 'ticket:update', 'ticket:delete', 'ticket:read']);
    const c = makeController();
    expect((await c.create()(request('POST', { board_name: 'X' }))).status).toBe(403);
    expect((await c.update()(request('PUT', { board_name: 'X' }))).status).toBe(403);
    expect((await c.delete()(request('DELETE'))).status).toBe(403);
    expect(state.serviceCalls).toEqual([]);
  });

  it('403s a non-internal principal even if it holds the permission, logging the principal code', async () => {
    state.userType = 'client';
    state.granted = new Set(['ticket_settings:create']);
    const warn = vi.spyOn(console, 'warn');
    const res = await makeController().create()(request('POST', { board_name: 'X' }));
    expect(res.status).toBe(403);
    expect(warn).toHaveBeenCalledWith('[boards] mutation refused', expect.objectContaining({ code: 'BOARD_PRINCIPAL_NOT_ALLOWED' }));
    expect(state.serviceCalls).toEqual([]);
  });

  it('allows create/update/delete with ticket_settings:* and no ticket:* write permission', async () => {
    state.granted = new Set(['ticket_settings:create', 'ticket_settings:update', 'ticket_settings:delete']);
    const c = makeController();
    expect((await c.create()(request('POST', { board_name: 'X' }))).status).toBe(201);
    expect((await c.update()(request('PUT', { board_name: 'Y' }))).status).toBe(200);
    expect((await c.delete()(request('DELETE'))).status).toBe(204);
    expect(state.serviceCalls).toEqual(['create', 'update', 'delete']);
  });

  it('keeps reads on ticket:read', async () => {
    state.granted = new Set(['ticket_settings:create']);
    expect((await makeController().getById()(request('GET'))).status).toBe(403);
    state.granted = new Set(['ticket:read']);
    expect((await makeController().getById()(request('GET'))).status).toBe(200);
  });

  it.each([
    ['tenant', { tenant: 'other' }],
    ['board_id', { board_id: B }],
    ['made-up column', { not_a_column: 1 }],
  ])('rejects unknown key %s with 400 and never reaches the service', async (_l, extra) => {
    state.granted = new Set(['ticket_settings:create', 'ticket_settings:update']);
    const c = makeController();
    expect((await c.create()(request('POST', { board_name: 'X', ...extra }))).status).toBe(400);
    expect((await c.update()(request('PUT', { board_name: 'X', ...extra }))).status).toBe(400);
    expect(state.serviceCalls).toEqual([]);
  });
});
