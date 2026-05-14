import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsertSearchDoc: vi.fn(),
}));

vi.mock('../../lib/search/upsert', () => ({
  upsertSearchDoc: mocks.upsertSearchDoc,
}));

import { clientIndexer } from '../../lib/search/indexers/client';
import { runSearchBackfill } from '../../scripts/search-backfill';
import type { SearchDoc } from '../../lib/search/types';

describe('search backfill script', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.upsertSearchDoc.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('T080 indexes all clients for a tenant when --tenant and --type=client are selected', async () => {
    const knex = vi.fn();
    const docs: SearchDoc[] = [
      {
        tenant: 'tenant-1',
        objectType: 'client',
        objectId: 'client-1',
        title: 'ACME Corp',
        url: '/msp/clients/client-1',
        acl: { requiredPermission: 'client:read' },
        sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
      },
      {
        tenant: 'tenant-1',
        objectType: 'client',
        objectId: 'client-2',
        title: 'Exchange Systems',
        url: '/msp/clients/client-2',
        acl: { requiredPermission: 'client:read' },
        sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
      },
    ];

    vi.spyOn(clientIndexer, 'loadBatch').mockResolvedValue(docs);

    await runSearchBackfill({ tenant: 'tenant-1', type: 'client' }, knex as never);

    expect(clientIndexer.loadBatch).toHaveBeenCalledTimes(1);
    expect(clientIndexer.loadBatch).toHaveBeenCalledWith(knex, 'tenant-1', null, 500);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(1, knex, docs[0]);
    expect(mocks.upsertSearchDoc).toHaveBeenNthCalledWith(2, knex, docs[1]);
    expect(knex).not.toHaveBeenCalledWith('tenants');
  });
});
