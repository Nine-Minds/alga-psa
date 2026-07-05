import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  upsertSearchDoc: vi.fn(),
  deleteSearchDoc: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where('tenant', tenant),
  }),
}));

vi.mock('@alga-psa/search/upsert', () => ({
  upsertSearchDoc: mocks.upsertSearchDoc,
  deleteSearchDoc: mocks.deleteSearchDoc,
}));

import { searchVisibleUserReindexHandler } from '../../lib/jobs/handlers/searchVisibleUserReindexHandler';
import { documentIndexer } from '@alga-psa/search/indexers/document';
import type { SearchDoc } from '@alga-psa/types';

describe('search visible-user reindex job', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.createTenantKnex.mockReset();
    mocks.upsertSearchDoc.mockReset();
    mocks.deleteSearchDoc.mockReset();
  });

  it('T190 refreshes a document row after a user is removed from visible_to_user_ids', async () => {
    const indexedRows = [{ object_type: 'document', object_id: 'document-1' }];
    const query = {
      select: vi.fn(() => query),
      where: vi.fn(() => query),
      whereRaw: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      andWhere: vi.fn(() => query),
      then: (
        resolve: (rows: typeof indexedRows) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(indexedRows).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      expect(table).toBe('app_search_index');
      return query;
    });
    const refreshedDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'document',
      objectId: 'document-1',
      title: 'Client runbook',
      url: '/msp/documents/document-1',
      acl: { requiredPermission: 'document:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };

    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    vi.spyOn(documentIndexer, 'loadOne').mockResolvedValue(refreshedDoc);

    await searchVisibleUserReindexHandler({
      tenantId: 'tenant-1',
      userId: '00000000-0000-0000-0000-000000000190',
      batchSize: 10,
    });

    expect(query.where).toHaveBeenCalledWith('tenant', 'tenant-1');
    expect(query.whereRaw).toHaveBeenCalledWith(
      '?::uuid = ANY(visible_to_user_ids)',
      ['00000000-0000-0000-0000-000000000190'],
    );
    expect(documentIndexer.loadOne).toHaveBeenCalledWith(knex, 'tenant-1', 'document-1');
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, refreshedDoc);
    expect(mocks.deleteSearchDoc).not.toHaveBeenCalled();
  });
});
