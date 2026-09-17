import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('../../../lib/db/db', () => ({ getConnection: vi.fn() }));

import { ApiInteractionController } from '../../../lib/api/controllers/ApiInteractionController';

const INTERACTION_ID = '11111111-1111-4111-8111-111111111111';
const STATUS_ID = '22222222-2222-4222-8222-222222222222';
const user = { user_id: 'u1', tenant: 'tenant-1', user_type: 'internal' };

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function putRequest(body: unknown, id = INTERACTION_ID) {
  const req = new NextRequest(`http://localhost:3000/api/v1/interactions/${id}`, {
    method: 'PUT',
    headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest & { params?: Promise<{ id: string }> };
  req.params = Promise.resolve({ id });
  return req;
}

function authenticated(controller: ApiInteractionController) {
  const checkPermission = vi.spyOn(controller as any, 'checkPermission').mockResolvedValue(undefined);
  vi.spyOn(controller as any, 'authenticate').mockImplementation(async (req: any) =>
    Object.assign(req, { context: { tenant: 'tenant-1', userId: 'u1', user } }),
  );
  return { checkPermission };
}

describe('Interaction status REST API', () => {
  let controller: ApiInteractionController;
  let service: { listStatuses: ReturnType<typeof vi.fn>; updateStatusOrNotes: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ApiInteractionController();
    service = { listStatuses: vi.fn(), updateStatusOrNotes: vi.fn() };
    (controller as any).interactionService = service;
  });

  it('lists the tenant statuses behind the read permission', async () => {
    const { checkPermission } = authenticated(controller);
    const statuses = [{ status_id: STATUS_ID, name: 'Done', is_closed: true, is_default: true, order_number: 1 }];
    service.listStatuses.mockResolvedValue(statuses);

    const res = await controller.listStatuses()(new NextRequest('http://localhost:3000/api/v1/interaction-statuses', { headers: { 'x-api-key': 'k' } }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(statuses);
    expect(checkPermission).toHaveBeenCalledWith(expect.anything(), 'read');
    expect(service.listStatuses).toHaveBeenCalledWith(expect.objectContaining({ tenant: 'tenant-1' }));
  });

  it('updates status and notes behind the update permission and returns the hydrated row', async () => {
    const { checkPermission } = authenticated(controller);
    const updated = { interaction_id: INTERACTION_ID, status_name: 'Done', notes: 'called back' };
    service.updateStatusOrNotes.mockResolvedValue(updated);

    const res = await controller.updateStatusOrNotes()(putRequest({ status_id: STATUS_ID, notes: 'called back' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual(updated);
    expect(checkPermission).toHaveBeenCalledWith(expect.anything(), 'update');
    expect(service.updateStatusOrNotes).toHaveBeenCalledWith(
      INTERACTION_ID,
      { status_id: STATUS_ID, notes: 'called back' },
      expect.objectContaining({ tenant: 'tenant-1' }),
    );
  });

  it('rejects bodies that carry nothing to change or web-only fields', async () => {
    authenticated(controller);

    for (const body of [{}, { title: 'nope' }, { status_id: 'not-a-uuid' }]) {
      const res = await controller.updateStatusOrNotes()(putRequest(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    }
    expect(service.updateStatusOrNotes).not.toHaveBeenCalled();
  });

  it('rejects a malformed interaction id before touching the service', async () => {
    authenticated(controller);

    const res = await controller.updateStatusOrNotes()(putRequest({ notes: 'x' }, 'not-a-uuid'));

    expect(res.status).toBe(400);
    expect(service.updateStatusOrNotes).not.toHaveBeenCalled();
  });

  it('surfaces service errors with their own status codes', async () => {
    authenticated(controller);
    const { NotFoundError } = await import('../../../lib/api/middleware/apiMiddleware');
    service.updateStatusOrNotes.mockRejectedValue(new NotFoundError('Interaction not found'));

    const res = await controller.updateStatusOrNotes()(putRequest({ notes: 'x' }));

    expect(res.status).toBe(404);
  });

  it('requires an API key on both endpoints', async () => {
    const listRes = await controller.listStatuses()(new NextRequest('http://localhost:3000/api/v1/interaction-statuses'));
    const updateReq = new NextRequest(`http://localhost:3000/api/v1/interactions/${INTERACTION_ID}`, { method: 'PUT', body: '{}' });
    const updateRes = await controller.updateStatusOrNotes()(updateReq);

    expect(listRes.status).toBe(401);
    expect(updateRes.status).toBe(401);
    expect(service.listStatuses).not.toHaveBeenCalled();
    expect(service.updateStatusOrNotes).not.toHaveBeenCalled();
  });

  it('routes PUT /interactions/{id} and GET /interaction-statuses to the controller', () => {
    const itemRoute = readSource('../../../app/api/v1/interactions/[id]/route.ts');
    const statusesRoute = readSource('../../../app/api/v1/interaction-statuses/route.ts');

    expect(itemRoute).toContain('export async function PUT(');
    expect(itemRoute).toContain('return controller.updateStatusOrNotes()(req);');
    expect(statusesRoute).toContain('return controller.listStatuses()(request as any);');
  });
});
