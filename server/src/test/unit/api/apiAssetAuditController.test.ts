import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Site audit routes (mobile 2.0 FR17): reading needs asset:read, every mutation
 * needs asset:update, and a mutation on a closed audit answers 409.
 */

const serviceState = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: unknown[] }>,
  audit: { audit_id: 'audit-1', status: 'in_progress', items: [] } as Record<string, unknown>,
  list: { data: [] as unknown[], total: 0 },
  throwOnMutation: null as Error | null,
}));

const permissions = vi.hoisted(() => ({ read: true, update: true }));

vi.mock('@/lib/api/services/AssetAuditService', () => ({
  AssetAuditService: class {
    async start(...args: unknown[]) {
      serviceState.calls.push({ method: 'start', args });
      if (serviceState.throwOnMutation) throw serviceState.throwOnMutation;
      return serviceState.audit;
    }
    async markItem(...args: unknown[]) {
      serviceState.calls.push({ method: 'markItem', args });
      if (serviceState.throwOnMutation) throw serviceState.throwOnMutation;
      return serviceState.audit;
    }
    async unmarkItem(...args: unknown[]) {
      serviceState.calls.push({ method: 'unmarkItem', args });
      if (serviceState.throwOnMutation) throw serviceState.throwOnMutation;
      return serviceState.audit;
    }
    async complete(...args: unknown[]) {
      serviceState.calls.push({ method: 'complete', args });
      if (serviceState.throwOnMutation) throw serviceState.throwOnMutation;
      return serviceState.audit;
    }
    async cancel(...args: unknown[]) {
      serviceState.calls.push({ method: 'cancel', args });
      if (serviceState.throwOnMutation) throw serviceState.throwOnMutation;
      return serviceState.audit;
    }
    async get(...args: unknown[]) {
      serviceState.calls.push({ method: 'get', args });
      return serviceState.audit;
    }
    async list(...args: unknown[]) {
      serviceState.calls.push({ method: 'list', args });
      return serviceState.list;
    }
  },
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
  ProductAccessError: class ProductAccessError extends Error {},
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, _resource: string, action: string) =>
    action === 'read' ? permissions.read : permissions.update,
  ),
}));

vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));

const { ApiAssetAuditController } = await import('@/lib/api/controllers/ApiAssetAuditController');
const { setRequestContext } = await import('@/lib/api/utils/requestContext');
const { ConflictError, handleApiError } = await import('@/lib/api/middleware/apiMiddleware');

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';
const ASSET = '33333333-3333-3333-3333-333333333333';
const AUDIT = '44444444-4444-4444-4444-444444444444';

function request(path: string, init?: { method?: string; body?: unknown }): NextRequest {
  const req = new NextRequest(`http://localhost${path}`, {
    method: init?.method ?? 'GET',
    ...(init?.body === undefined
      ? {}
      : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
  });
  setRequestContext(req, {
    tenant: TENANT,
    userId: 'user-1',
    user: { user_id: 'user-1', tenant: TENANT, user_type: 'internal' },
  } as never);
  return req;
}

beforeEach(() => {
  serviceState.calls = [];
  serviceState.throwOnMutation = null;
  permissions.read = true;
  permissions.update = true;
});

describe('ApiAssetAuditController', () => {
  it('T055 starts an audit with asset:update and answers 201', async () => {
    const response = await new ApiAssetAuditController().create(
      request('/api/v1/asset-audits', {
        method: 'POST',
        body: { client_id: CLIENT, location_id: null, statuses: ['active'] },
      }),
    );

    expect(response.status).toBe(201);
    expect(serviceState.calls[0].method).toBe('start');
    expect(serviceState.calls[0].args[0]).toMatchObject({ client_id: CLIENT, statuses: ['active'] });
  });

  it('T055 refuses to start an audit without asset:update', async () => {
    permissions.update = false;

    const response = await new ApiAssetAuditController().create(
      request('/api/v1/asset-audits', { method: 'POST', body: { client_id: CLIENT } }),
    );

    expect(response.status).toBe(403);
    expect(serviceState.calls).toHaveLength(0);
  });

  it('rejects a body that is missing client_id', async () => {
    const response = await new ApiAssetAuditController().create(
      request('/api/v1/asset-audits', { method: 'POST', body: { statuses: ['active'] } }),
    );

    expect(response.status).toBe(400);
    expect(serviceState.calls).toHaveLength(0);
  });

  it('lists audits with asset:read and passes the client filter through', async () => {
    serviceState.list = { data: [{ audit_id: AUDIT }], total: 1 };

    const response = await new ApiAssetAuditController().list(
      request(`/api/v1/asset-audits?client_id=${CLIENT}&limit=5`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination).toMatchObject({ page: 1, limit: 5, total: 1 });
    expect(serviceState.calls[0].args[0]).toMatchObject({ client_id: CLIENT, limit: 5 });
  });

  it('refuses to list audits without asset:read', async () => {
    permissions.read = false;

    const response = await new ApiAssetAuditController().list(request('/api/v1/asset-audits'));

    expect(response.status).toBe(403);
  });

  it('marks an item through the service', async () => {
    const response = await new ApiAssetAuditController().markItem(
      request(`/api/v1/asset-audits/${AUDIT}/items`, {
        method: 'POST',
        body: { asset_id: ASSET, result: 'present', method: 'scan' },
      }),
      { id: AUDIT },
    );

    expect(response.status).toBe(200);
    expect(serviceState.calls[0]).toMatchObject({ method: 'markItem' });
    expect(serviceState.calls[0].args[1]).toMatchObject({ asset_id: ASSET, method: 'scan' });
  });

  it('T056 surfaces a closed audit as 409', async () => {
    serviceState.throwOnMutation = new ConflictError('Audit is completed');

    let status = 0;
    try {
      await new ApiAssetAuditController().markItem(
        request(`/api/v1/asset-audits/${AUDIT}/items`, { method: 'POST', body: { asset_id: ASSET } }),
        { id: AUDIT },
      );
    } catch (error) {
      status = handleApiError(error).status;
    }

    expect(status).toBe(409);
  });

  it('unmarks, completes and cancels through the service with asset:update', async () => {
    const controller = new ApiAssetAuditController();

    await controller.unmarkItem(
      request(`/api/v1/asset-audits/${AUDIT}/items/${ASSET}`, { method: 'DELETE' }),
      { id: AUDIT, assetId: ASSET },
    );
    await controller.complete(
      request(`/api/v1/asset-audits/${AUDIT}/complete`, { method: 'POST' }),
      { id: AUDIT },
    );
    await controller.cancel(request(`/api/v1/asset-audits/${AUDIT}/cancel`, { method: 'POST' }), { id: AUDIT });

    expect(serviceState.calls.map((call) => call.method)).toEqual(['unmarkItem', 'complete', 'cancel']);

    permissions.update = false;
    const denied = await controller.complete(
      request(`/api/v1/asset-audits/${AUDIT}/complete`, { method: 'POST' }),
      { id: AUDIT },
    );
    expect(denied.status).toBe(403);
  });

  it('reads one audit with asset:read', async () => {
    const response = await new ApiAssetAuditController().getById(
      request(`/api/v1/asset-audits/${AUDIT}`),
      { id: AUDIT },
    );

    expect(response.status).toBe(200);
    expect(serviceState.calls[0]).toMatchObject({ method: 'get' });
  });
});
