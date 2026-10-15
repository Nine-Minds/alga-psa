import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

import { ApiBaseController, type AuthenticatedApiRequest } from '../../../lib/api/controllers/ApiBaseController';
import { updateClientSchema } from '../../../lib/api/schemas/client';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerClientContactRoutes } from '../../../lib/api/openapi/routes/clientsContacts';

class ClientUpdateController extends ApiBaseController {
  protected async authenticate(req: NextRequest) {
    return Object.assign(req, { context: { tenant: 'test-tenant' } }) as AuthenticatedApiRequest;
  }

  protected async checkPermission() {}

  protected async runWithApiKeyContext<T>(_req: AuthenticatedApiRequest, callback: () => Promise<T>): Promise<T> {
    return callback();
  }
}

const clientId = '00000000-0000-4000-8000-000000000001';

function request(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/v1/clients/${clientId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/v1/clients/{id}', () => {
  it.each([
    ['email', 'x@example.com'],
    ['phone_no', '555-0100'],
    ['address', '1 Main St'],
  ])('returns a field-specific 400 for %s before calling the service', async (field, value) => {
    const update = vi.fn();
    const controller = new ClientUpdateController({ update } as any, {
      resource: 'client', updateSchema: updateClientSchema,
    } as any);

    const response = await controller.update()(request({ [field]: value }));
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: [field], message: expect.stringContaining('client locations endpoint') }),
    ]));
    expect(update).not.toHaveBeenCalled();
  });

  it('strips unknown keys before calling the service', async () => {
    const update = vi.fn().mockResolvedValue({ client_id: clientId, client_name: 'Renamed client' });
    const controller = new ClientUpdateController({ update } as any, {
      resource: 'client', updateSchema: updateClientSchema,
    } as any);

    const response = await controller.update()(request({ client_name: 'Renamed client', default_locale: 'fr', mystery: true }));
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(clientId, { client_name: 'Renamed client' }, expect.anything());
  });

  it('documents location guidance and omits location fields from the update body', () => {
    const registry = createRegistry();
    registerClientContactRoutes(registry);
    const document = registry.buildDocument({ title: 'Client API Test', version: '1.0.0', edition: 'ce' });
    const operation = document.paths?.['/api/v1/clients/{id}']?.put;
    expect(operation?.description).toContain('/api/v1/clients/{id}/locations');
    const body = operation?.requestBody?.content?.['application/json']?.schema;
    expect(body?.properties).not.toHaveProperty('email');
    expect(body?.properties).not.toHaveProperty('phone_no');
    expect(body?.properties).not.toHaveProperty('address');
  });
});
