import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../../../test-utils/testContext';
import { ensureExtensionStorageTables } from '../../../../e2e/api/extension-storage.helpers';
import { ExtensionStorageServiceV2 } from '@ee/lib/extensions/storage/v2/service';
import {
  StorageLimitError,
  StorageQuotaError,
  StorageRevisionMismatchError,
  StorageServiceError,
  StorageValidationError,
} from '@ee/lib/extensions/storage/v2/errors';

process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'test_password';
process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'test_password';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_DIRECT_HOST = process.env.DB_DIRECT_HOST || process.env.DB_HOST;
process.env.DB_DIRECT_PORT = process.env.DB_DIRECT_PORT || process.env.DB_PORT;
process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';

const namespace = 'ext-gaps-tests';

describe('ExtensionStorageServiceV2 edge cases (infrastructure)', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;
  let service: ExtensionStorageServiceV2;
  let installId: string;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({ runSeeds: true });
    await ensureExtensionStorageTables();
  }, 180_000);

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  beforeEach(async () => {
    context = await testHelpers.beforeEach();
    installId = uuidv4();
    service = new ExtensionStorageServiceV2(context.db, context.tenantId, installId);
  });

  afterEach(async () => {
    await testHelpers.afterEach();
  });

  it('bulkPut should enforce per-item ifRevision for existing keys', async () => {
    // Seed an initial record at revision 1
    await service.put({ namespace, key: 'concurrent', value: { v: 1 } });

    // Stale write in bulk payload should be rejected with a revision mismatch
    await expect(
      service.bulkPut({
        namespace,
        items: [
          { key: 'concurrent', value: { v: 2 }, ifRevision: 999 }, // stale
        ],
      }),
    ).rejects.toBeInstanceOf(StorageRevisionMismatchError);
  });

  it('list keyPrefix should treat % literally (no SQL wildcard injection)', async () => {
    await service.put({ namespace, key: 'ab%1', value: { x: 1 } });
    await service.put({ namespace, key: 'abX', value: { x: 2 } });

    const res = await service.list({ namespace, keyPrefix: 'ab%', limit: 10, includeValues: false });
    const keys = res.items.map((i) => i.key);
    // Expect only the literal prefix match for "ab%" (i.e., key starting with the two characters 'a','b' and then '%')
    expect(keys).toEqual(['ab%1']);
  });

  it('list should reject malformed cursor values instead of silently resetting pagination', async () => {
    const malformedCursor = Buffer.from(JSON.stringify({}), 'utf8').toString('base64url');
    await expect(
      service.list({ namespace, cursor: malformedCursor, limit: 10 }),
    ).rejects.toBeInstanceOf(StorageValidationError);
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

    // Fresh service instance with small totalBytes
    const svc = new ExtensionStorageServiceV2(context.db, context.tenantId, installId, quota);

    const p1 = svc.put({ namespace, key: 'race-1', value: { data: 'x'.repeat(60) } });
    const p2 = svc.put({ namespace, key: 'race-2', value: { data: 'y'.repeat(60) } });

    // Expect one to fail with quota exceeded rather than both succeeding
    const results = await Promise.allSettled([p1, p2]);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.length).toBe(1);
    expect((rejected[0].reason as any)?.code).toBe('QUOTA_EXCEEDED');
  });

  it('rejects ttlSeconds below minimum and cleans up expired records', async () => {
    await expect(
      service.put({ namespace, key: 'ttl-too-low', value: { ok: true }, ttlSeconds: 10 }),
    ).rejects.toBeInstanceOf(StorageLimitError);

    // Write a valid TTL, then force-expire it in DB and trigger cleanup via list/get
    const key = 'ttl-expire';
    await service.put({ namespace, key, value: { ok: true }, ttlSeconds: 60 });

    // Force the record to be expired
    await context.db('ext_storage_records')
      .where({ tenant: context.tenantId, extension_install_id: installId, namespace, key })
      .update({ ttl_expires_at: new Date(Date.now() - 1000).toISOString() });

    // Trigger cleanup and verify disappearance
    await service.list({ namespace, limit: 5 });
    await expect(service.get({ namespace, key })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }, 20_000);

  it('supports version history (only one active at a time)', async () => {
    const base = {
      tenant: context.tenantId,
      extension_install_id: installId,
      namespace,
      schema_document: { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: true },
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as const;

    await context.db('ext_storage_schemas').insert({ ...base, schema_version: 1, status: 'active' });
    // New version can be added as draft while previous remains active
    await expect(
      context.db('ext_storage_schemas').insert({ ...base, schema_version: 2, status: 'draft' }),
    ).resolves.toBeTruthy();
  });
});
