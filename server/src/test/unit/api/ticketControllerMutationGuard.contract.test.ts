import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  deniedActions: new Set<string>(),
  authorize: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../../lib/api/controllers/authorizationKernel', async (original) => ({
  ...(await original<object>()),
  authorizeApiResourceAction: h.authorize,
}));
vi.mock('../../../lib/api/services/TicketService', () => ({
  TicketService: class {
    getById = h.getById;
    update = h.update;
    delete = h.delete;
  },
}));
vi.mock('../../../lib/db/db', () => ({ getConnection: async () => ({}) }));
vi.mock('../../../lib/db', () => ({
  runWithTenant: async (_tenant: string, work: () => Promise<unknown>) => work(),
}));

import { ApiTicketController } from '../../../lib/api/controllers/ApiTicketController';

const TICKET_ID = '22222222-2222-4222-8222-222222222222';
const context = {
  tenant: '11111111-1111-4111-8111-111111111111',
  userId: 'user-1',
  user: { user_id: 'user-1', user_type: 'internal' },
  apiKeyId: 'key-1',
};
const ticket = { ticket_id: TICKET_ID, title: 'Original' };

function request(method: 'GET' | 'PUT' | 'DELETE') {
  return new NextRequest(`http://localhost/api/v1/tickets/${TICKET_ID}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'PUT' ? { body: JSON.stringify({ title: 'Updated' }) } : {}),
  });
}

function controller() {
  const instance = new ApiTicketController();
  // Supply identity and coarse RBAC; keep record authorization and handlers real.
  Object.assign(instance, {
    authenticate: async (req: NextRequest) => Object.assign(req, { context }),
    checkPermission: async () => undefined,
  });
  return instance;
}

describe('ApiTicketController mutation authorization guard', () => {
  beforeEach(() => {
    h.deniedActions = new Set();
    h.authorize.mockReset().mockImplementation(async ({ action }: { action: string }) => !h.deniedActions.has(action));
    h.getById.mockReset().mockResolvedValue(ticket);
    h.update.mockReset().mockResolvedValue({ ...ticket, title: 'Updated' });
    h.delete.mockReset().mockResolvedValue(undefined);
  });

  it.each([
    { action: 'update', method: 'PUT' },
    { action: 'delete', method: 'DELETE' },
  ] as const)('denies $action outside its scope while GET still returns the ticket', async ({ action, method }) => {
    h.deniedActions.add(action);
    const instance = controller();
    const read = await instance.getById()(request('GET'));
    expect(read.status).toBe(200);
    expect((await read.json()).data).toMatchObject(ticket);

    const response = await instance[action]()(request(method));
    expect(response.status).toBe(403);
    expect(h.authorize).toHaveBeenCalledWith(expect.objectContaining({ resource: 'ticket', action }));
    expect(h.update).not.toHaveBeenCalled();
    expect(h.delete).not.toHaveBeenCalled();
  });

  it('requires read scope for GET and updates that return the ticket', async () => {
    h.deniedActions.add('read');
    const instance = controller();
    expect((await instance.getById()(request('GET'))).status).toBe(403);
    expect((await instance.update()(request('PUT'))).status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
  });

  it('allows an authorized update and returns the changed ticket', async () => {
    const response = await controller().update()(request('PUT'));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ ticket_id: TICKET_ID, title: 'Updated' });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.authorize.mock.calls.map(([input]) => input.action)).toEqual(['update', 'read']);
  });

  it('allows an authorized delete without requiring read scope', async () => {
    h.deniedActions.add('read');
    const response = await controller().delete()(request('DELETE'));
    expect(response.status).toBe(204);
    expect(h.delete).toHaveBeenCalledWith(TICKET_ID, context);
    expect(h.authorize.mock.calls.map(([input]) => input.action)).toEqual(['delete']);
  });
});
