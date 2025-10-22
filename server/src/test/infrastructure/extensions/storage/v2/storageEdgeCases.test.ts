import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import { TestContext } from '../../../../../../test-utils/testContext';
import { ensureStorageTables, resetStorageTables } from '../../../../e2e/api/storage.helpers';
import { createTestDbConnection } from '../../../../../../test-utils/dbConfig';
import { StorageService } from '@/lib/storage/api/service';
import {
  StorageLimitError,
  StorageRevisionMismatchError,
  StorageServiceError,
  StorageValidationError,
} from '@/lib/storage/api/errors';

process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'test_password';
process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'test_password';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_DIRECT_HOST = process.env.DB_DIRECT_HOST || process.env.DB_HOST;
process.env.DB_DIRECT_PORT = process.env.DB_DIRECT_PORT || process.env.DB_PORT;
process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';

const namespace = 'storage-edge-tests';

describe('StorageService edge cases (infrastructure)', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;
  let service: StorageService;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({ runSeeds: true });
    await ensureStorageTables();
  }, 180_000);

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  beforeEach(async () => {
    context = await testHelpers.beforeEach();
    await resetStorageTables(context.tenantId);
    service = new StorageService(context.db, context.tenantId);
  });

  afterEach(async () => {
    await testHelpers.afterEach();
  });

  it('bulkPut should enforce per-item ifRevision for existing keys', async () => {
    await service.put({ namespace, key: 'concurrent', value: { v: 1 } });

    await expect(
      service.bulkPut({
        namespace,
        items: [
          { key: 'concurrent', value: { v: 2 }, ifRevision: 999 },
        ],
      }),
    ).rejects.toBeInstanceOf(StorageRevisionMismatchError);
  });

  it('list keyPrefix should treat % literally (no SQL wildcard injection)', async () => {
    await service.put({ namespace, key: 'ab%1', value: { x: 1 } });
    await service.put({ namespace, key: 'abX', value: { x: 2 } });

    const res = await service.list({ namespace, keyPrefix: 'ab%', limit: 10, includeValues: false });
    const keys = res.items.map((i) => i.key);
    expect(keys).toEqual(['ab%1']);
  });

  it('list should reject malformed cursor values instead of silently resetting pagination', async () => {
    const malformedCursor = Buffer.from(JSON.stringify({}), 'utf8').toString('base64url');
    await expect(service.list({ namespace, cursor: malformedCursor, limit: 10 })).rejects.toBeInstanceOf(
      StorageValidationError,
    );
  });

  it('should enforce totalBytes quota under concurrent first-time writes (race)', async () => {
    const quota = {
      maxNamespaces: 32,
      maxKeysPerNamespace: 5120,
      maxValueBytes: 64 * 1024,
      maxMetadataBytes: 4 * 1024,
      maxBulkPayloadBytes: 512 * 1024,
      maxBulkItems: 20,
      totalBytes: 80,
    } as const;

    const svc = new StorageService(context.db, context.tenantId, quota);

    const p1 = svc.put({ namespace, key: 'race-1', value: { data: 'x'.repeat(60) } });
    const p2 = svc.put({ namespace, key: 'race-2', value: { data: 'y'.repeat(60) } });

    const results = await Promise.allSettled([p1, p2]);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.length).toBe(1);
    expect((rejected[0].reason as StorageServiceError).code).toBe('QUOTA_EXCEEDED');
  });

  it('rejects ttlSeconds below minimum and cleans up expired records', async () => {
    await expect(
      service.put({ namespace, key: 'ttl-too-low', value: { ok: true }, ttlSeconds: 10 }),
    ).rejects.toBeInstanceOf(StorageLimitError);

    const key = 'ttl-expire';
    await service.put({ namespace, key, value: { ok: true }, ttlSeconds: 60 });

    await context.db('storage_records')
      .where({ tenant: context.tenantId, namespace, key })
      .update({ ttl_expires_at: new Date(Date.now() - 1000).toISOString() });

    await service.list({ namespace, limit: 5 });
    await expect(service.get({ namespace, key })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }, 20_000);

  it('supports version history (only one active at a time)', async () => {
    const base = {
      tenant: context.tenantId,
      namespace,
      schema_document: { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: true },
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as const;

    await context.db('storage_schemas').insert({ ...base, schema_version: 1, status: 'active' });

    await expect(
      context.db('storage_schemas').insert({ ...base, schema_version: 2, status: 'draft' }),
    ).resolves.toBeTruthy();
  });

});

describe('StorageService revision semantics (committed connections)', () => {
  beforeAll(async () => {
    await ensureStorageTables();
  }, 180_000);

  afterEach(async () => {
    await resetStorageTables();
  });

  it('exposes latest revision across independent connections', async () => {
    const tenantId = randomUUID();

    const writer = await createTestDbConnection();
    try {
      const writerService = new StorageService(writer, tenantId);
      const put1 = await writerService.put({ namespace, key: 'revision-visibility', value: { version: 1 } });
      expect(put1.revision).toBe(1);

      const put2 = await writerService.put({ namespace, key: 'revision-visibility', value: { version: 2 } });
      expect(put2.revision).toBe(2);
    } finally {
      await writer.destroy();
    }

    const reader = await createTestDbConnection();
    try {
      const readerService = new StorageService(reader, tenantId);
      const key = 'revision-visibility';
      const record = await readerService.get({ namespace, key });
      expect(record.revision).toBe(2);
      expect(record.value).toEqual({ version: 2 });

      await expect(readerService.get({ namespace, key, ifRevision: 1 })).rejects.toMatchObject({
        code: 'REVISION_MISMATCH',
      });
      const guarded = await readerService.get({ namespace, key, ifRevision: 2 });
      expect(guarded.revision).toBe(2);

      await expect(readerService.delete({ namespace, key, ifRevision: 1 })).rejects.toBeInstanceOf(
        StorageRevisionMismatchError,
      );

      await readerService.delete({ namespace, key, ifRevision: 2 });
      await expect(readerService.get({ namespace, key })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await reader.destroy();
    }
  });
});
