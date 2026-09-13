// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The controller wires its own service and performs auth inside runWithTenant.
// A full route harness (real HTTP + API-key validation + DB) is impractical in
// a unit suite, so this focused test stubs the transport concerns and asserts
// the serialized success envelope carries the service result's closure fields.
// This is the controller-boundary half of the PRD's "exercise both response
// paths" requirement; the DB-backed integration suite proves the service values.

vi.mock('../../../lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/db')>()),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../../lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/db/db')>()),
  getConnection: async () => ({}),
}));

vi.mock('../../../lib/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/auth/rbac')>()),
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/users/actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/users/actions')>()),
  findUserByIdForApi: async () => ({
    user_id: 'user-1',
    user_type: 'internal',
    tenant: 'tenant-1',
  }),
}));

vi.mock('../../../lib/services/apiKeyServiceForApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/services/apiKeyServiceForApi')>()),
  ApiKeyServiceForApi: {
    validateApiKeyForTenant: async () => ({
      user_id: 'user-1',
      tenant: 'tenant-1',
      api_key_id: 'key-1',
    }),
    validateApiKeyAnyTenant: async () => ({
      user_id: 'user-1',
      tenant: 'tenant-1',
      api_key_id: 'key-1',
    }),
  },
}));

vi.mock('../../../lib/api/middleware/apiMiddleware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/middleware/apiMiddleware')>()),
  assertInternalApiUser: () => undefined,
}));

import { ApiTicketController } from '../../../lib/api/controllers/ApiTicketController';

const CLOSED_STATUS_ID = '11111111-1111-4111-8111-111111111111';

const closedTicket = {
  ticket_id: 'ticket-1',
  status_id: CLOSED_STATUS_ID,
  is_closed: true,
  closed_at: new Date('2026-09-13T12:00:00.000Z'),
  closed_by: 'user-1',
};

function stubController(updateResult: Record<string, unknown>) {
  const controller = new ApiTicketController();
  const internals = controller as any;

  internals.service = { update: vi.fn(async () => updateResult) };
  internals.ticketService = internals.service;

  vi.spyOn(internals, 'authenticate').mockImplementation(async (request: any) => {
    request.context = { tenant: 'tenant-1', userId: 'user-1', user: { user_type: 'internal' } };
    return request;
  });
  vi.spyOn(internals, 'checkPermission').mockResolvedValue(undefined);
  vi.spyOn(internals, 'extractIdFromPath').mockResolvedValue('ticket-1');
  vi.spyOn(internals, 'assertTicketReadAllowed').mockResolvedValue(undefined);
  vi.spyOn(internals, 'validateData').mockResolvedValue({ status_id: CLOSED_STATUS_ID });
  vi.spyOn(internals, 'assertProductApiAccess').mockResolvedValue(undefined);

  return { controller, internals };
}

describe('ApiTicketController closure response serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('general update handler returns the service closure fields in the success envelope', async () => {
    const { controller, internals } = stubController(closedTicket);
    const handler = controller.update();
    const request = new NextRequest('http://localhost/api/v1/tickets/ticket-1', {
      method: 'PUT',
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.is_closed).toBe(true);
    expect(body.data.closed_at).toBe('2026-09-13T12:00:00.000Z');
    expect(body.data.closed_by).toBe('user-1');
    expect(internals.service.update).toHaveBeenCalledTimes(1);
  });

  it('status update handler returns the service closure fields in the success envelope', async () => {
    const { controller, internals } = stubController(closedTicket);
    const handler = controller.updateStatus();
    const request = new NextRequest('http://localhost/api/v1/tickets/ticket-1/status', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-key',
        'x-tenant-id': 'tenant-1',
      },
      body: JSON.stringify({ status_id: CLOSED_STATUS_ID }),
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.is_closed).toBe(true);
    expect(body.data.closed_at).toBe('2026-09-13T12:00:00.000Z');
    expect(body.data.closed_by).toBe('user-1');
    expect(internals.ticketService.update).toHaveBeenCalledTimes(1);
  });
});
