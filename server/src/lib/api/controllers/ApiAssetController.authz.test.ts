import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  authorizeApiResource: vi.fn(),
  getConnection: vi.fn(),
  service: {
    list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    getAuthorizationRecord: vi.fn(), getRelationshipAssetIds: vi.fn(), deleteRelationship: vi.fn(),
    getDocumentAssociationAssetId: vi.fn(), removeDocumentAssociation: vi.fn(),
  },
}));

vi.mock('../../auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('../../db/db', () => ({ getConnection: mocks.getConnection }));
vi.mock('./authorizationKernel', () => ({ authorizeApiResource: mocks.authorizeApiResource }));
vi.mock('@/lib/productAccess', () => ({
  ProductAccessError: class ProductAccessError extends Error {},
  getTenantProduct: vi.fn(async () => 'community'),
}));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: () => 'allowed' }));
vi.mock('../services/AssetService', () => ({
  AssetService: class {
    list = mocks.service.list;
    create = mocks.service.create;
    update = mocks.service.update;
    delete = mocks.service.delete;
    getAuthorizationRecord = mocks.service.getAuthorizationRecord;
    getRelationshipAssetIds = mocks.service.getRelationshipAssetIds;
    deleteRelationship = mocks.service.deleteRelationship;
    getDocumentAssociationAssetId = mocks.service.getDocumentAssociationAssetId;
    removeDocumentAssociation = mocks.service.removeDocumentAssociation;
  },
}));

import { ApiAssetController } from './ApiAssetController';

function apiRequest(path: string, method: string, body?: unknown): NextRequest {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  Object.defineProperty(request, 'context', {
    value: {
      tenant: 'tenant-a',
      userId: 'user-a',
      user: { user_id: 'user-a', user_type: 'internal' },
      apiKeyId: 'api-key-a',
    },
  });
  return request;
}

describe('ApiAssetController coarse authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnection.mockResolvedValue({});
    mocks.hasPermission.mockResolvedValue(false);
    mocks.authorizeApiResource.mockResolvedValue(true);
  });

  it('blocks an authenticated API-key user without asset permissions before reads or mutations reach the service', async () => {
    const controller = new ApiAssetController();
    const responses = await Promise.all([
      controller.list(apiRequest('/api/v1/assets', 'GET')),
      controller.create(apiRequest('/api/v1/assets', 'POST', {})),
      controller.update(apiRequest('/api/v1/assets/asset-a', 'PUT', {}), { id: 'asset-a' }),
      controller.delete(apiRequest('/api/v1/assets/asset-a', 'DELETE'), { id: 'asset-a' }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(mocks.service.list).not.toHaveBeenCalled();
    expect(mocks.service.create).not.toHaveBeenCalled();
    expect(mocks.service.update).not.toHaveBeenCalled();
    expect(mocks.service.delete).not.toHaveBeenCalled();
  });

  it('denies every public controller action when the key owner has no matching asset permission', async () => {
    const controller = new ApiAssetController();
    const actions = [
      () => controller.list(apiRequest('/api/v1/assets', 'GET')),
      () => controller.getById(apiRequest('/api/v1/assets/a', 'GET'), { id: 'a' }),
      () => controller.create(apiRequest('/api/v1/assets', 'POST', {})),
      () => controller.update(apiRequest('/api/v1/assets/a', 'PUT', {}), { id: 'a' }),
      () => controller.delete(apiRequest('/api/v1/assets/a', 'DELETE'), { id: 'a' }),
      () => controller.listRelationships(apiRequest('/api/v1/assets/a/relationships', 'GET'), { id: 'a' }),
      () => controller.listAssignments(apiRequest('/api/v1/assets/a/assignments', 'GET'), { id: 'a' }),
      () => controller.listStatuses(apiRequest('/api/v1/asset-statuses', 'GET')),
      () => controller.listTickets(apiRequest('/api/v1/assets/a/tickets', 'GET'), { id: 'a' }),
      () => controller.linkTicket(apiRequest('/api/v1/assets/a/tickets', 'POST', {}), { id: 'a' }),
      () => controller.unlinkTicket(apiRequest('/api/v1/assets/a/tickets/t', 'DELETE'), { id: 'a', ticketId: 't' }),
      () => controller.createRelationship(apiRequest('/api/v1/assets/a/relationships', 'POST', {}), { id: 'a' }),
      () => controller.deleteRelationship(apiRequest('/api/v1/assets/relationships/r', 'DELETE'), { relationshipId: 'r' }),
      () => controller.listDocuments(apiRequest('/api/v1/assets/a/documents', 'GET'), { id: 'a' }),
      () => controller.associateDocument(apiRequest('/api/v1/assets/a/documents', 'POST', {}), { id: 'a' }),
      () => controller.removeDocumentAssociation(apiRequest('/api/v1/assets/documents/d', 'DELETE'), { associationId: 'd' }),
      () => controller.listMaintenanceSchedules(apiRequest('/api/v1/assets/a/maintenance', 'GET'), { id: 'a' }),
      () => controller.createMaintenanceSchedule(apiRequest('/api/v1/assets/a/maintenance', 'POST', {}), { id: 'a' }),
      () => controller.updateMaintenanceSchedule(apiRequest('/api/v1/assets/maintenance/m', 'PUT', {}), { scheduleId: 'm' }),
      () => controller.deleteMaintenanceSchedule(apiRequest('/api/v1/assets/maintenance/m', 'DELETE'), { scheduleId: 'm' }),
      () => controller.recordMaintenance(apiRequest('/api/v1/assets/a/maintenance/record', 'POST', {}), { id: 'a' }),
      () => controller.getMaintenanceHistory(apiRequest('/api/v1/assets/a/history', 'GET'), { id: 'a' }),
      () => controller.search(apiRequest('/api/v1/assets/search', 'GET')),
      () => controller.export(apiRequest('/api/v1/assets/export', 'GET')),
      () => controller.getStatistics(apiRequest('/api/v1/assets/stats', 'GET')),
      () => controller.bulkUpdate(apiRequest('/api/v1/assets/bulk-update', 'PUT', {})),
      () => controller.bulkStatusUpdate(apiRequest('/api/v1/assets/bulk-status', 'PUT', {})),
    ];

    for (const invoke of actions) {
      expect((await invoke()).status).toBe(403);
    }
    expect(mocks.hasPermission).toHaveBeenCalled();
    expect(Object.values(mocks.service).every((method) => method.mock.calls.length === 0)).toBe(true);
  });

  it('checks every bulk target before the first update and leaves data unchanged on a record denial', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    mocks.service.getAuthorizationRecord.mockImplementation(async (id: string) => ({ id, clientId: null }));
    mocks.authorizeApiResource.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const controller = new ApiAssetController();
    const response = await controller.bulkUpdate(apiRequest('/api/v1/assets/bulk-update', 'PUT', {
      assets: [
        { asset_id: '11111111-1111-4111-8111-111111111111', data: { name: 'First' } },
        { asset_id: '22222222-2222-4222-8222-222222222222', data: { name: 'Second' } },
      ],
    }));

    expect(response.status).toBe(404);
    expect(mocks.service.getAuthorizationRecord).toHaveBeenCalledTimes(2);
    expect(mocks.service.update).not.toHaveBeenCalled();
  });

  it('resolves relationship ids in the tenant and does not delete if any affected asset is denied', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    mocks.service.getRelationshipAssetIds.mockResolvedValue([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    mocks.service.getAuthorizationRecord.mockImplementation(async (id: string) => ({ id, clientId: null }));
    mocks.authorizeApiResource.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const controller = new ApiAssetController();
    const response = await controller.deleteRelationship(
      apiRequest('/api/v1/assets/relationships/r', 'DELETE'),
      { relationshipId: 'r' },
    );

    expect(response.status).toBe(404);
    expect(mocks.service.getRelationshipAssetIds.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.service.getAuthorizationRecord.mock.invocationCallOrder[0]);
    expect(mocks.service.deleteRelationship).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing tenant-scoped association before asset authorization', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    mocks.service.getRelationshipAssetIds.mockResolvedValue(null);
    mocks.service.getDocumentAssociationAssetId.mockResolvedValue(null);
    const controller = new ApiAssetController();

    const relationship = await controller.deleteRelationship(
      apiRequest('/api/v1/assets/relationships/missing', 'DELETE'),
      { relationshipId: 'missing' },
    );
    const document = await controller.removeDocumentAssociation(
      apiRequest('/api/v1/assets/documents/missing', 'DELETE'),
      { associationId: 'missing' },
    );

    expect(relationship.status).toBe(404);
    expect(document.status).toBe(404);
    expect(mocks.service.getAuthorizationRecord).not.toHaveBeenCalled();
    expect(mocks.service.deleteRelationship).not.toHaveBeenCalled();
    expect(mocks.service.removeDocumentAssociation).not.toHaveBeenCalled();
  });
});
