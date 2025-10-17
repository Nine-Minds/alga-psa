import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { TestContext } from '../../../../../../test-utils/testContext';
import { ensureStorageTables, resetStorageTables } from '../../../../e2e/api/storage.helpers';
import { StorageService } from '@/lib/storage/api/service';
import { StorageValidationError } from '@/lib/storage/api/errors';

process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'test_password';
process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'test_password';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_DIRECT_HOST = process.env.DB_DIRECT_HOST || process.env.DB_HOST;
process.env.DB_DIRECT_PORT = process.env.DB_DIRECT_PORT || process.env.DB_PORT;
process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';

const namespace = 'storage-metadata-tests';

describe('StorageService metadata (infrastructure)', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;
  let service: StorageService;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({ runSeeds: true });
    await ensureStorageTables();
  }, 120_000);

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

  it('persists metadata when writing records and exposes it via get', async () => {
    const metadata = {
      contentType: 'application/json',
      flags: { pinned: true, source: 'infrastructure-test' },
    } satisfies Record<string, unknown>;

    await service.put({
      namespace,
      key: 'profile',
      value: { theme: 'dark', locale: 'en-US' },
      metadata,
    });

    const stored = await context
      .db('storage_records')
      .where({
        tenant: context.tenantId,
        namespace,
        key: 'profile',
      })
      .first();

    expect(stored?.metadata).toEqual(metadata);
    expect(Number(stored?.metadata_size_bytes ?? 0)).toBeGreaterThan(0);

    const record = await service.get({ namespace, key: 'profile' });
    expect(record.metadata).toEqual(metadata);
    expect(record.value).toEqual({ theme: 'dark', locale: 'en-US' });
  });

  it('returns metadata only when explicitly requested from list', async () => {
    const metadata = { stage: 'beta', rollout: 5 } satisfies Record<string, unknown>;
    await service.put({ namespace, key: 'feature-flag', value: { enabled: true }, metadata });

    const withoutMetadata = await service.list({ namespace, limit: 10 });
    const withoutItem = withoutMetadata.items.find((item) => item.key === 'feature-flag');
    expect(withoutItem).toBeDefined();
    expect(withoutItem?.metadata).toBeUndefined();

    const withMetadata = await service.list({ namespace, limit: 10, includeMetadata: true });
    const withItem = withMetadata.items.find((item) => item.key === 'feature-flag');
    expect(withItem).toBeDefined();
    expect(withItem?.metadata).toEqual(metadata);
  });

  it('defaults metadata to an empty object when not provided', async () => {
    await service.put({ namespace, key: 'implicit-metadata', value: { attempt: 1 } });

    const record = await service.get({ namespace, key: 'implicit-metadata' });
    expect(record.metadata).toEqual({});
  });

  it('rejects non-object metadata payloads', async () => {
    await expect(
      service.put({ namespace, key: 'invalid-null', value: { ok: false }, metadata: null as any })
    ).rejects.toBeInstanceOf(StorageValidationError);

    await expect(
      service.put({ namespace, key: 'invalid-array', value: { ok: false }, metadata: [] as any })
    ).rejects.toBeInstanceOf(StorageValidationError);
  });
});
