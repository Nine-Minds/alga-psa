import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * T147 behaviour — F102: GET /api/v1/assets/{id}/assignments returns the
 * assignment history, and answers 404 for an asset the caller's tenant cannot
 * see (the service is tenant-scoped, so another tenant's id resolves to null).
 */

const serviceState = vi.hoisted(() => ({
  asset: null as { asset_id: string } | null,
  assignments: [] as unknown[],
  authorizationCalls: [] as Array<{ id: string; tenant: string }>,
  assignmentLoads: 0,
  decision: { allowed: true, redactedFields: [] as string[] },
}));

vi.mock('@/lib/api/services/AssetService', () => ({
  AssetService: class {
    async getAuthorizationRecord(id: string, context: { tenant: string }) {
      serviceState.authorizationCalls.push({ id, tenant: context.tenant });
      return serviceState.asset ? { id: serviceState.asset.asset_id } : null;
    }
    async getAssetAssignments() {
      serviceState.assignmentLoads += 1;
      return serviceState.assignments;
    }
  },
}));

vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({
    authorizeResource: vi.fn(async () => serviceState.decision),
  })),
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
  ProductAccessError: class ProductAccessError extends Error {},
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => () => {
    const query = { where: () => query, select: async () => [] };
    return query;
  }),
}));

const { ApiAssetController } = await import('@/lib/api/controllers/ApiAssetController');
const { setRequestContext } = await import('@/lib/api/utils/requestContext');

const TENANT = '11111111-1111-1111-1111-111111111111';
const ASSET = '22222222-2222-2222-2222-222222222222';

function request(assetId: string): NextRequest {
  const req = new NextRequest(`http://localhost/api/v1/assets/${assetId}/assignments`);
  setRequestContext(req, {
    tenant: TENANT,
    user: { user_id: 'user-1', tenant: TENANT, user_type: 'internal' },
  } as any);
  return req;
}

beforeEach(() => {
  serviceState.asset = null;
  serviceState.assignments = [];
  serviceState.authorizationCalls = [];
  serviceState.assignmentLoads = 0;
  serviceState.decision = { allowed: true, redactedFields: [] };
});

describe('ApiAssetController.listAssignments', () => {
  it('returns the assignment history for an asset in the caller tenant', async () => {
    serviceState.asset = { asset_id: ASSET };
    serviceState.assignments = [
      { assignment_id: 'a-2', contact_name_id: 'c-2', unassigned_at: null, source: 'manual' },
      { assignment_id: 'a-1', contact_name_id: 'c-1', unassigned_at: '2026-10-01T00:00:00.000Z', source: 'rmm' },
    ];

    const response = await new ApiAssetController().listAssignments(request(ASSET), { id: ASSET });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ assignment_id: 'a-2', unassigned_at: null });
    expect(serviceState.authorizationCalls).toEqual([{ id: ASSET, tenant: TENANT }]);
  });

  it("404s for another tenant's asset", async () => {
    serviceState.asset = null;

    const response = await new ApiAssetController().listAssignments(request(ASSET), { id: ASSET });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error?.code ?? body.code).toBe('NOT_FOUND');
    expect(serviceState.assignmentLoads).toBe(0);
  });

  it('does not load assignment history when the asset policy denies the caller', async () => {
    serviceState.asset = { asset_id: ASSET };
    serviceState.decision = { allowed: false, redactedFields: [] };

    const response = await new ApiAssetController().listAssignments(request(ASSET), { id: ASSET });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(serviceState.assignmentLoads).toBe(0);
  });

  it('projects joined contact labels under the asset policy', async () => {
    serviceState.asset = { asset_id: ASSET };
    serviceState.assignments = [{ assignment_id: 'a-1', contact_name: 'Private contact', source: 'manual' }];
    const controller = new ApiAssetController();
    const visible = await controller.listAssignments(request(ASSET), { id: ASSET });
    expect((await visible.json()).data[0].contact_name).toBe('Private contact');

    serviceState.decision = { allowed: true, redactedFields: ['contacts.full_name'] };
    const hidden = await controller.listAssignments(request(ASSET), { id: ASSET });
    expect(hidden.status).toBe(200);
    expect((await hidden.json()).data).toEqual([{ assignment_id: 'a-1', contact_name: null, source: 'manual' }]);
  });
});
