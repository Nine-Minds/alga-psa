import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsertSearchDoc: vi.fn(),
  deleteSearchDoc: vi.fn(),
}));

vi.mock('@alga-psa/search/upsert', () => ({
  upsertSearchDoc: mocks.upsertSearchDoc,
  deleteSearchDoc: mocks.deleteSearchDoc,
}));

import {
  deleteRowsMissingFromSource,
  insertRowsMissingFromIndex,
  reindexRowsAfterWatermark,
} from '@alga-psa/jobs/handlers/searchReconcileHandler';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

const repoRoot = resolve(__dirname, '../../../..');

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
    const query = {
      where: vi.fn(() => query),
      max: vi.fn(() => query),
      first: vi.fn(async () => ({ max_source_updated_at: '2026-05-13T12:00:00.000Z' })),
    };
    const knex = vi.fn((table: string) => {
      expect(table).toBe('app_search_index');
      return query;
    });
    const indexer: EntityIndexer = {
      objectType: 'client',
      sourceEvents: [],
      loadOne: vi.fn(),
      loadBatch: vi.fn(async (_knex, _tenant, cursor) => (cursor === null ? [olderDoc, newerDoc] : [])),
    };

    const result = await reindexRowsAfterWatermark(knex as never, 'tenant-1', indexer);

    expect(query.where).toHaveBeenNthCalledWith(1, 'app_search_index.tenant', 'tenant-1');
    expect(query.where).toHaveBeenNthCalledWith(2, { object_type: 'client' });
    expect(query.max).toHaveBeenCalledWith({ max_source_updated_at: 'source_updated_at' });
    expect(result).toEqual({ scanned: 2, reindexed: 1 });
    expect(mocks.upsertSearchDoc).toHaveBeenCalledTimes(1);
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, newerDoc);
  });

  it('T086 deletes indexed rows whose source row is missing', async () => {
    const existingDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'client',
      objectId: 'client-present',
      title: 'Present client',
      url: '/msp/clients/client-present',
      acl: { requiredPermission: 'client:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const indexedRows = [
      { object_id: 'client-present' },
      { object_id: 'client-missing' },
    ];
    const query = {
      select: vi.fn(() => query),
      where: vi.fn(() => query),
      andWhere: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      then: (
        resolve: (rows: typeof indexedRows) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(indexedRows).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      expect(table).toBe('app_search_index');
      return query;
    });
    const indexer: EntityIndexer = {
      objectType: 'client',
      sourceEvents: [],
      loadOne: vi.fn(async (_knex, _tenant, id) => (
        id === 'client-present' ? existingDoc : null
      )),
      loadBatch: vi.fn(),
    };

    const result = await deleteRowsMissingFromSource(knex as never, 'tenant-1', indexer);

    expect(query.where).toHaveBeenCalledWith('app_search_index.tenant', 'tenant-1');
    expect(query.andWhere).toHaveBeenCalledWith('object_type', 'client');
    expect(indexer.loadOne).toHaveBeenNthCalledWith(1, knex, 'tenant-1', 'client-present');
    expect(indexer.loadOne).toHaveBeenNthCalledWith(2, knex, 'tenant-1', 'client-missing');
    expect(result).toEqual({ checked: 2, deleted: 1 });
    expect(mocks.deleteSearchDoc).toHaveBeenCalledWith(
      knex,
      'tenant-1',
      'client',
      'client-missing',
    );
  });

  it('T087 inserts source rows that are missing from the index', async () => {
    const presentDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'client',
      objectId: 'client-present',
      title: 'Present client',
      url: '/msp/clients/client-present',
      acl: { requiredPermission: 'client:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const missingDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'client',
      objectId: 'client-missing',
      title: 'Missing client',
      url: '/msp/clients/client-missing',
      acl: { requiredPermission: 'client:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const query = {
      select: vi.fn(() => query),
      where: vi.fn(() => query),
      andWhere: vi.fn(() => query),
      whereIn: vi.fn(() => query),
      then: (
        resolve: (rows: Array<{ object_id: string }>) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve([{ object_id: 'client-present' }]).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      expect(table).toBe('app_search_index');
      return query;
    });
    const indexer: EntityIndexer = {
      objectType: 'client',
      sourceEvents: [],
      loadOne: vi.fn(),
      loadBatch: vi.fn(async (_knex, _tenant, cursor) => (
        cursor === null ? [presentDoc, missingDoc] : []
      )),
    };

    const result = await insertRowsMissingFromIndex(knex as never, 'tenant-1', indexer);

    expect(query.where).toHaveBeenCalledWith('app_search_index.tenant', 'tenant-1');
    expect(query.andWhere).toHaveBeenCalledWith('object_type', 'client');
    expect(query.whereIn).toHaveBeenCalledWith('object_id', ['client-present', 'client-missing']);
    expect(result).toEqual({ scanned: 2, inserted: 1 });
    expect(mocks.upsertSearchDoc).toHaveBeenCalledTimes(1);
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, missingDoc);
  });

  it('T088 registers and schedules the search reconciliation job daily', () => {
    const registerAllHandlers = readFileSync(
      resolve(repoRoot, 'server/src/lib/jobs/registerAllHandlers.ts'),
      'utf8',
    );
    const initializeScheduledJobs = readFileSync(
      resolve(repoRoot, 'server/src/lib/jobs/initializeScheduledJobs.ts'),
      'utf8',
    );
    const jobsIndex = readFileSync(resolve(repoRoot, 'server/src/lib/jobs/index.ts'), 'utf8');
    const reconcileHandler = readFileSync(
      resolve(repoRoot, 'packages/jobs/src/lib/handlers/searchReconcileHandler.ts'),
      'utf8',
    );

    expect(registerAllHandlers).toContain('JobHandlerRegistry.register<SearchReconcileJobData');
    expect(registerAllHandlers).toContain('name: SEARCH_RECONCILE_JOB_NAME');
    expect(registerAllHandlers).toContain('await searchReconcileHandler(data)');
    expect(initializeScheduledJobs).toContain("const cron = '0 6 * * *';");
    expect(initializeScheduledJobs).toContain('scheduleSearchReconcileJob(tenantId, cron)');
    expect(reconcileHandler).toContain("SEARCH_RECONCILE_JOB_NAME = 'search:reconcile'");
    expect(reconcileHandler).toContain(".unscoped<TenantRecord>('tenants', SEARCH_RECONCILE_TENANT_ENUMERATION_REASON)");
    expect(jobsIndex).toContain('scheduleRecurringJob<SearchReconcileJobData>');
  });

  it('T173 restores a manually deleted index row during reconciliation', async () => {
    const sourceDoc: SearchDoc = {
      tenant: 'tenant-1',
      objectType: 'client',
      objectId: 'client-deleted-from-index',
      title: 'Restored client',
      url: '/msp/clients/client-deleted-from-index',
      acl: { requiredPermission: 'client:read' },
      sourceUpdatedAt: new Date('2026-05-13T12:00:00.000Z'),
    };
    const query = {
      select: vi.fn(() => query),
      where: vi.fn(() => query),
      andWhere: vi.fn(() => query),
      whereIn: vi.fn(() => query),
      then: (
        resolve: (rows: Array<{ object_id: string }>) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve([]).then(resolve, reject),
    };
    const knex = vi.fn((table: string) => {
      expect(table).toBe('app_search_index');
      return query;
    });
    const indexer: EntityIndexer = {
      objectType: 'client',
      sourceEvents: [],
      loadOne: vi.fn(),
      loadBatch: vi.fn(async (_knex, _tenant, cursor) => (
        cursor === null ? [sourceDoc] : []
      )),
    };

    const result = await insertRowsMissingFromIndex(knex as never, 'tenant-1', indexer);

    expect(query.where).toHaveBeenCalledWith('app_search_index.tenant', 'tenant-1');
    expect(query.andWhere).toHaveBeenCalledWith('object_type', 'client');
    expect(query.whereIn).toHaveBeenCalledWith('object_id', ['client-deleted-from-index']);
    expect(result).toEqual({ scanned: 1, inserted: 1 });
    expect(mocks.upsertSearchDoc).toHaveBeenCalledWith(knex, sourceDoc);
  });

  it('T195 emits per-run reconciliation summary counts', () => {
    const reconcileHandler = readFileSync(
      resolve(repoRoot, 'packages/jobs/src/lib/handlers/searchReconcileHandler.ts'),
      'utf8',
    );

    expect(reconcileHandler).toContain("logger.info('[SearchReconcileJob] Re-indexed rows after watermark'");
    expect(reconcileHandler).toContain('tenant,');
    expect(reconcileHandler).toContain('objectType: indexer.objectType');
    expect(reconcileHandler).toContain('...updatedCounts');
    expect(reconcileHandler).toContain('staleDeleted: staleCounts.deleted');
    expect(reconcileHandler).toContain('missingInserted: missingCounts.inserted');
  });

  it('T205 skips unregistered orphan object types during reconciliation', () => {
    const reconcileHandler = readFileSync(
      resolve(repoRoot, 'packages/jobs/src/lib/handlers/searchReconcileHandler.ts'),
      'utf8',
    );

    expect(reconcileHandler).toContain('const indexer = getIndexer(data.type)');
    expect(reconcileHandler).toContain("logger.info('[SearchReconcileJob] Skipping unregistered search object_type'");
    expect(reconcileHandler).toContain('return [];');
    expect(reconcileHandler).toContain('const indexers = resolveReconcileIndexers(data)');
    expect(reconcileHandler).toContain('for (const indexer of indexers)');
  });
});
