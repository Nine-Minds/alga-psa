import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsertSearchDoc: vi.fn(),
}));

vi.mock('../../lib/search/upsert', () => ({
  upsertSearchDoc: mocks.upsertSearchDoc,
}));

import { clientIndexer } from '../../lib/search/indexers/client';
import { allIndexers } from '../../lib/search';
import { runSearchBackfill, upsertBackfillBatches } from '../../scripts/search-backfill';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

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

  it('T081 processes a 10k-row table in 500-row batches', async () => {
    const knex = vi.fn();
    let nextIndex = 0;
    const makeDoc = (index: number): SearchDoc => ({
      tenant: 'tenant-1',
      objectType: 'client',
      objectId: `client-${index.toString().padStart(5, '0')}`,
      title: `Client ${index}`,
      url: `/msp/clients/client-${index}`,
      acl: { requiredPermission: 'client:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    });
    const loadBatch = vi.fn(async (_knex, _tenant, _cursor, limit: number) => {
      expect(limit).toBe(500);
      if (nextIndex >= 10_000) {
        return [];
      }

      const docs = Array.from({ length: 500 }, (_, offset) => makeDoc(nextIndex + offset));
      nextIndex += docs.length;
      return docs;
    });
    const indexer: EntityIndexer = {
      objectType: 'client',
      sourceEvents: [],
      loadOne: vi.fn(),
      loadBatch,
    };

    const total = await upsertBackfillBatches(knex as never, 'tenant-1', indexer);

    expect(total).toBe(10_000);
    expect(loadBatch).toHaveBeenCalledTimes(21);
    expect(loadBatch.mock.calls[0]).toEqual([knex, 'tenant-1', null, 500]);
    expect(loadBatch.mock.calls[1]?.[2]).toBe('client-00499');
    expect(loadBatch.mock.calls[20]?.[2]).toBe('client-09999');
    expect(mocks.upsertSearchDoc).toHaveBeenCalledTimes(10_000);
  });

  it('T082 running backfill twice produces identical row content', async () => {
    const knex = vi.fn();
    const docs: SearchDoc[] = [
      {
        tenant: 'tenant-1',
        objectType: 'client',
        objectId: 'client-1',
        title: 'ACME Corp',
        subtitle: 'ops@acme.test',
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
    const loadBatch = vi.fn(async (_knex, _tenant, cursor: string | null) => (
      cursor === null ? docs : []
    ));
    const indexer: EntityIndexer = {
      objectType: 'client',
      sourceEvents: [],
      loadOne: vi.fn(),
      loadBatch,
    };
    const rows = new Map<string, SearchDoc>();
    mocks.upsertSearchDoc.mockImplementation(async (_knex, doc: SearchDoc) => {
      rows.set(`${doc.tenant}:${doc.objectType}:${doc.objectId}`, doc);
    });

    await upsertBackfillBatches(knex as never, 'tenant-1', indexer);
    const firstRunRows = Array.from(rows.entries());
    await upsertBackfillBatches(knex as never, 'tenant-1', indexer);

    expect(loadBatch).toHaveBeenCalledTimes(2);
    expect(mocks.upsertSearchDoc).toHaveBeenCalledTimes(4);
    expect(Array.from(rows.entries())).toEqual(firstRunRows);
  });

  it('T083 discovers and iterates all tenants when --tenant is omitted', async () => {
    const tenantRows = [{ tenant: 'tenant-a' }, { tenant: 'tenant-b' }];
    const tenantQuery = {
      select: vi.fn(() => tenantQuery),
      orderBy: vi.fn(() => tenantQuery),
      then: (
        resolve: (rows: typeof tenantRows) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(tenantRows).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      if (table === 'tenants') {
        return tenantQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const loadBatch = vi.spyOn(clientIndexer, 'loadBatch').mockImplementation(
      async (_knex, tenant, cursor) => (
        cursor === null
          ? [{
            tenant,
            objectType: 'client',
            objectId: `${tenant}-client`,
            title: `Client ${tenant}`,
            url: `/msp/clients/${tenant}-client`,
            acl: { requiredPermission: 'client:read' },
            sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
          }]
          : []
      ),
    );

    await runSearchBackfill({ type: 'client' }, knex as never);

    expect(knex).toHaveBeenCalledWith('tenants');
    expect(tenantQuery.select).toHaveBeenCalledWith('tenant');
    expect(tenantQuery.orderBy).toHaveBeenCalledWith('tenant', 'asc');
    expect(loadBatch).toHaveBeenNthCalledWith(1, knex, 'tenant-a', null, 500);
    expect(loadBatch).toHaveBeenNthCalledWith(2, knex, 'tenant-b', null, 500);
    expect(mocks.upsertSearchDoc).toHaveBeenCalledTimes(2);
  });

  it('T084 wires npm run search:backfill in root package.json', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), '../package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['search:backfill']).toBe('tsx server/src/scripts/search-backfill.ts');
  });

  it('T172 backfills a sampled searchable row for every registered entity type', async () => {
    const knex = vi.fn();
    const indexers = allIndexers();
    expect(indexers).toHaveLength(28);

    for (const indexer of indexers) {
      vi.spyOn(indexer, 'loadBatch').mockImplementation(
        async (_knex, tenant, cursor) => (
          cursor === null
            ? [{
              tenant,
              objectType: indexer.objectType,
              objectId: `${indexer.objectType}-sample`,
              title: `${indexer.objectType} searchable sample`,
              url: `/msp/search-sample/${indexer.objectType}`,
              acl: { requiredPermission: 'client:read' },
              sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
            }]
            : []
        ),
      );
    }

    await runSearchBackfill({ tenant: 'tenant-1' }, knex as never);

    const upsertedDocs = mocks.upsertSearchDoc.mock.calls.map((call) => call[1] as SearchDoc);
    expect(upsertedDocs).toHaveLength(28);
    expect(new Set(upsertedDocs.map((doc) => doc.objectType))).toEqual(
      new Set(indexers.map((indexer) => indexer.objectType)),
    );
    expect(upsertedDocs.every((doc) => doc.tenant === 'tenant-1')).toBe(true);
    expect(upsertedDocs.every((doc) => doc.title.includes('searchable sample'))).toBe(true);
  });
});
