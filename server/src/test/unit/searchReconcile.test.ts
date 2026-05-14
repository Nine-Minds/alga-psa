import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsertSearchDoc: vi.fn(),
  deleteSearchDoc: vi.fn(),
}));

vi.mock('../../lib/search/upsert', () => ({
  upsertSearchDoc: mocks.upsertSearchDoc,
  deleteSearchDoc: mocks.deleteSearchDoc,
}));

import { reindexRowsAfterWatermark } from '../../lib/jobs/handlers/searchReconcileHandler';
import type { EntityIndexer, SearchDoc } from '../../lib/search/types';

describe('search reconciliation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.upsertSearchDoc.mockReset();
    mocks.deleteSearchDoc.mockReset();
  });

  it('T085 re-indexes source rows whose source_updated_at advanced past the index watermark', async () => {
    const olderDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'client',
      objectId: 'client-old',
      title: 'Old client',
      url: '/msp/clients/client-old',
      acl: { requiredPermission: 'client:read' },
      sourceUpdatedAt: new Date('2026-05-13T11:00:00.000Z'),
    };
    const newerDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'client',
      objectId: 'client-new',
      title: 'New client',
      url: '/msp/clients/client-new',
      acl: { requiredPermission: 'client:read' },
      sourceUpdatedAt: new Date('2026-05-13T13:00:00.000Z'),
    };
    const knex = {
      raw: vi.fn(async () => ({
        rows: [{ max_source_updated_at: '2026-05-13T12:00:00.000Z' }],
      })),
    };
    const indexer: EntityIndexer = {
      objectType: 'client',
      sourceEvents: [],
      loadOne: vi.fn(),
      loadBatch: vi.fn(async (_knex, _tenant, cursor) => (cursor === null ? [olderDoc, newerDoc] : [])),
    };

    const result = await reindexRowsAfterWatermark(knex as never, 'tenant-1', indexer);

    expect(knex.raw).toHaveBeenCalledWith(expect.stringContaining('max(source_updated_at)'), [
      'tenant-1',
      'client',
    ]);
    expect(result).toEqual({ scanned: 2, reindexed: 1 });
    expect(mocks.upsertSearchDoc).toHaveBeenCalledTimes(1);
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, newerDoc);
  });
});
