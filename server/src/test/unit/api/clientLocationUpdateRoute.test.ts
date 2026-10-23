import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

vi.mock('../../../lib/db', () => ({
  runWithTenant: (_tenant: string, callback: () => Promise<unknown>) => callback(),
}));

import { ApiClientController } from '../../../lib/api/controllers/ApiClientController';
import type { AuthenticatedApiRequest } from '../../../lib/api/controllers/ApiBaseController';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerClientContactRoutes } from '../../../lib/api/openapi/routes/clientsContacts';

const clientId = '00000000-0000-4000-8000-000000000001';
const locationId = '00000000-0000-4000-8000-000000000002';

class LocationController extends ApiClientController {
  constructor(clientService: Record<string, unknown>) {
    super();
    (this as any).clientService = clientService;
  }

  protected async authenticate(req: NextRequest) {
    return Object.assign(req, { context: { tenant: 'test-tenant' } }) as AuthenticatedApiRequest;
  }

  protected async checkPermission() {}
}

function request(method: 'PUT' | 'DELETE', body?: Record<string, unknown>, ids = { clientId, locationId }) {
  return new NextRequest(`http://localhost/api/v1/clients/${ids.clientId}/locations/${ids.locationId}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('PUT /api/v1/clients/{id}/locations/{locationId}', () => {
  it('updates the location with the parsed partial body', async () => {
    const updateLocation = vi.fn().mockResolvedValue({ location_id: locationId, phone: '+1 320 252 1658' });
    const controller = new LocationController({ getById: vi.fn().mockResolvedValue({ client_id: clientId }), updateLocation });

    const response = await controller.updateLocation()(request('PUT', { phone: '+1 320 252 1658', email: 'ops@acme.test', mystery: 1 }));

    expect(response.status).toBe(200);
    // The shared phone schema stores E.164; unknown keys are dropped.
    expect(updateLocation).toHaveBeenCalledWith(clientId, locationId, { phone: '+13202521658', email: 'ops@acme.test' }, expect.anything());
  });

  it('allows a location without a street address so a phone-only client can be edited', async () => {
    const updateLocation = vi.fn().mockResolvedValue({ location_id: locationId });
    const controller = new LocationController({ getById: vi.fn().mockResolvedValue({ client_id: clientId }), updateLocation });

    const response = await controller.updateLocation()(request('PUT', { address_line1: '', city: '', phone: '+1 320 252 1658' }));

    expect(response.status).toBe(200);
    expect(updateLocation).toHaveBeenCalledWith(clientId, locationId, expect.objectContaining({ address_line1: '', city: '' }), expect.anything());
  });

  it('rejects a malformed location id before touching the service', async () => {
    const updateLocation = vi.fn();
    const controller = new LocationController({ getById: vi.fn(), updateLocation });

    const response = await controller.updateLocation()(request('PUT', { phone: '1' }, { clientId, locationId: 'nope' }));

    expect(response.status).toBe(400);
    expect(updateLocation).not.toHaveBeenCalled();
  });

  it('returns 404 when the client does not exist', async () => {
    const updateLocation = vi.fn();
    const controller = new LocationController({ getById: vi.fn().mockResolvedValue(null), updateLocation });

    const response = await controller.updateLocation()(request('PUT', { phone: '1' }));

    expect(response.status).toBe(404);
    expect(updateLocation).not.toHaveBeenCalled();
  });

  it('deletes the location and answers 204', async () => {
    const deleteLocation = vi.fn().mockResolvedValue(undefined);
    const controller = new LocationController({ getById: vi.fn().mockResolvedValue({ client_id: clientId }), deleteLocation });

    const response = await controller.deleteLocation()(request('DELETE'));

    expect(response.status).toBe(204);
    expect(deleteLocation).toHaveBeenCalledWith(clientId, locationId, expect.anything());
  });

  it('is documented alongside the existing location routes', () => {
    const registry = createRegistry();
    registerClientContactRoutes(registry);
    const document = registry.buildDocument({ title: 'Client API Test', version: '1.0.0', edition: 'ce' });
    const path = document.paths?.['/api/v1/clients/{id}/locations/{locationId}'];
    expect(path?.put?.summary).toBe('Update client location');
    expect(path?.delete?.summary).toBe('Delete client location');
    const createBody = document.paths?.['/api/v1/clients/{id}/locations']?.post?.requestBody?.content?.['application/json']?.schema;
    expect(createBody?.required ?? []).not.toContain('address_line1');
    expect(createBody?.required ?? []).not.toContain('city');
  });
});
