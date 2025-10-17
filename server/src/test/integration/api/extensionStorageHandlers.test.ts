import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AsyncLocalStorage } from 'node:async_hooks';

import { TestContext } from '../../../../test-utils/testContext';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import {
  STORAGE_NAMESPACE as namespace,
  configureExtensionStorageTestDatabase,
  ensureExtensionStorageTables,
  seedExtensionData,
} from '../../e2e/api/extension-storage.helpers';
import { GET as getRecord, PUT as putRecord, DELETE as deleteRecord } from '@product/extension-storage-api/ee/record-impl';
import { GET as listRecords, POST as bulkPutRecords } from '@product/extension-storage-api/ee/records-impl';
import { ExtensionStorageServiceV2 } from '../../../../../ee/server/src/lib/extensions/storage/v2/service';
import * as storageFactory from '../../../../../ee/server/src/lib/extensions/storage/v2/factory';
import * as userActions from 'server/src/lib/actions/user-actions/userActions';
import * as rbac from 'server/src/lib/auth/rbac';

if (typeof (globalThis as any).AsyncLocalStorage === 'undefined') {
  (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
}

process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'test_password';
process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'test_password';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';

configureExtensionStorageTestDatabase();

describe('Extension Storage Route Handlers', () => {
  const testHelpers = TestContext.createHelpers();
  const origin = 'http://127.0.0.1';

  let tenantId = '';
  let installId = '';
  let originalEdition: string | undefined;
  let originalPublicEdition: string | undefined;
  let getCurrentUserSpy: ReturnType<typeof vi.spyOn> | null = null;
  let hasPermissionSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeAll(async () => {
    originalEdition = process.env.EDITION;
    originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const ctx = await testHelpers.beforeAll();
    tenantId = ctx.tenantId;
    await ensureExtensionStorageTables();
    const seed = await seedExtensionData(tenantId, namespace);
    installId = seed.installId;
  }, 120_000);

  afterAll(async () => {
    await testHelpers.afterAll();
    if (originalEdition === undefined) {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }
    if (originalPublicEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
    }
  });

  beforeEach(async () => {
    const ctx = await testHelpers.beforeEach();
    tenantId = ctx.tenantId;
    const seed = await seedExtensionData(tenantId, namespace);
    installId = seed.installId;
  });

  afterEach(async () => {
    await testHelpers.afterEach();
    getCurrentUserSpy?.mockRestore();
    hasPermissionSpy?.mockRestore();
    getCurrentUserSpy = null;
    hasPermissionSpy = null;
  });

  function mockAuth(permissionGranted = true, userTenant?: string) {
    getCurrentUserSpy?.mockRestore();
    hasPermissionSpy?.mockRestore();
    getCurrentUserSpy = vi.spyOn(userActions, 'getCurrentUser').mockImplementation(async () => ({
      user_id: 'user-1',
      tenant: userTenant ?? tenantId,
      user_type: 'internal',
      roles: [],
    }) as any);
    hasPermissionSpy = vi.spyOn(rbac, 'hasPermission').mockResolvedValue(permissionGranted);
  }

  function buildRecordsUrl(query?: Record<string, string | number | boolean>): string {
    const url = new URL(`/api/ext-storage/install/${installId}/${namespace}/records`, origin);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  function buildRecordUrl(key: string): string {
    return `${origin}/api/ext-storage/install/${installId}/${namespace}/records/${encodeURIComponent(key)}`;
  }

  function jsonRequest(
    method: string,
    url: string,
    body?: unknown,
    options?: { tenantHeader?: string | null; headers?: Record<string, string> },
  ): NextRequest {
    const headers = new Headers(options?.headers ?? {});
    if (options?.tenantHeader !== null) {
      headers.set('x-tenant-id', options?.tenantHeader ?? tenantId);
    }
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
      payload = JSON.stringify(body);
    }
    const base = new Request(url, { method, headers, body: payload });
    return new NextRequest(base);
  }

  async function readJson<T>(response: Response): Promise<T> {
    const clone = response.clone();
    return (await clone.json()) as T;
  }

  it('should create and retrieve a record via PUT/GET', async () => {
    mockAuth();

    const key = 'preferences';
    const payload = {
      value: { theme: 'dark', notifications: true },
      metadata: { contentType: 'application/json' },
    };

    const putResponse = await putRecord(jsonRequest('PUT', buildRecordUrl(key), payload), {
      params: { installId, namespace, key },
    });
    expect(putResponse.status).toBe(200);
    const putData: any = await readJson(putResponse);
    expect(putData).toMatchObject({ namespace, key, revision: 1 });

    const getResponse = await getRecord(jsonRequest('GET', buildRecordUrl(key)), {
      params: { installId, namespace, key },
    });
    expect(getResponse.status).toBe(200);
    const getData: any = await readJson(getResponse);
    expect(getData.value).toEqual(payload.value);
    expect(getData.metadata).toEqual(payload.metadata);
  });

  it('should list records with optional value and metadata', async () => {
    mockAuth();

    await putRecord(jsonRequest('PUT', buildRecordUrl('list-one'), { value: { id: 1 }, metadata: { marker: 'one' } }), {
      params: { installId, namespace, key: 'list-one' },
    });
    await putRecord(jsonRequest('PUT', buildRecordUrl('list-two'), { value: { id: 2 }, metadata: { marker: 'two' } }), {
      params: { installId, namespace, key: 'list-two' },
    });

    const listResponse = await listRecords(jsonRequest('GET', buildRecordsUrl({ includeValues: true, includeMetadata: true, limit: 10 })), {
      params: { installId, namespace },
    });
    expect(listResponse.status).toBe(200);
    const listData: any = await readJson(listResponse);
    expect(Array.isArray(listData.items)).toBe(true);
    const keys = listData.items.map((item: any) => item.key);
    expect(keys).toEqual(expect.arrayContaining(['list-one', 'list-two']));
    const one = listData.items.find((item: any) => item.key === 'list-one');
    expect(one.value).toEqual({ id: 1 });
    expect(one.metadata).toEqual({ marker: 'one' });
  });

  it('should enforce optimistic concurrency', async () => {
    mockAuth();

    const key = 'revision-check';

    const initial = await putRecord(jsonRequest('PUT', buildRecordUrl(key), { value: { step: 1 } }), {
      params: { installId, namespace, key },
    });
    expect(initial.status).toBe(200);
    const firstData: any = await readJson(initial);
    expect(firstData.revision).toBe(1);

    const update = await putRecord(jsonRequest('PUT', buildRecordUrl(key), { value: { step: 2 }, ifRevision: firstData.revision }), {
      params: { installId, namespace, key },
    });
    expect(update.status).toBe(200);
    const secondData: any = await readJson(update);
    expect(secondData.revision).toBe(2);

    const stale = await putRecord(jsonRequest('PUT', buildRecordUrl(key), { value: { step: 3 }, ifRevision: 1 }), {
      params: { installId, namespace, key },
    });
    expect(stale.status).toBe(409);
    const staleBody: any = await readJson(stale);
    expect(staleBody.error.code).toBe('REVISION_MISMATCH');
  });

  it('should delete a record', async () => {
    mockAuth();

    const key = 'delete-me';
    await putRecord(jsonRequest('PUT', buildRecordUrl(key), { value: { active: true } }), {
      params: { installId, namespace, key },
    });

    const deleteResponse = await deleteRecord(jsonRequest('DELETE', buildRecordUrl(key)), {
      params: { installId, namespace, key },
    });
    expect(deleteResponse.status).toBe(204);
    const text = await deleteResponse.text();
    expect(text).toBe('');

    const missing = await getRecord(jsonRequest('GET', buildRecordUrl(key)), {
      params: { installId, namespace, key },
    });
    expect(missing.status).toBe(404);
    const missingBody: any = await readJson(missing);
    expect(missingBody.error.code).toBe('NOT_FOUND');
  });

  it('should insert multiple records with bulkPut', async () => {
    mockAuth();

    const bulkResponse = await bulkPutRecords(
      jsonRequest('POST', buildRecordsUrl(), {
        items: [
          { key: 'bulk-one', value: { id: 1 } },
          { key: 'bulk-two', value: { id: 2 }, metadata: { label: 'two' } },
        ],
      }),
      { params: { installId, namespace } },
    );
    expect(bulkResponse.status).toBe(200);
    const bulkData: any = await readJson(bulkResponse);
    expect(bulkData.items).toHaveLength(2);

    const first = await getRecord(jsonRequest('GET', buildRecordUrl('bulk-one')), {
      params: { installId, namespace, key: 'bulk-one' },
    });
    expect(first.status).toBe(200);
    const firstBody: any = await readJson(first);
    expect(firstBody.value).toEqual({ id: 1 });

    const second = await getRecord(jsonRequest('GET', buildRecordUrl('bulk-two')), {
      params: { installId, namespace, key: 'bulk-two' },
    });
    expect(second.status).toBe(200);
    const secondBody: any = await readJson(second);
    expect(secondBody.metadata).toEqual({ label: 'two' });
  });

  it('should enforce total storage quota', async () => {
    mockAuth();

    const quota = {
      maxNamespaces: 32,
      maxKeysPerNamespace: 5120,
      maxValueBytes: 512,
      maxMetadataBytes: 4 * 1024,
      maxBulkPayloadBytes: 512 * 1024,
      maxBulkItems: 20,
      totalBytes: 96,
    } as const;

    const original = storageFactory.getStorageServiceForInstall;
    const spy = vi.spyOn(storageFactory, 'getStorageServiceForInstall').mockImplementation(async (installIdArg) => {
      const context = await original(installIdArg);
      return {
        ...context,
        service: new ExtensionStorageServiceV2(context.knex, context.tenantId, context.installId, quota),
      };
    });

    try {
      const seedKey = 'quota-seed';
      const first = await putRecord(jsonRequest('PUT', buildRecordUrl(seedKey), { value: { data: 'x'.repeat(40) } }), {
        params: { installId, namespace, key: seedKey },
      });
      expect(first.status).toBe(200);

      const overKey = 'quota-over';
      const over = await putRecord(jsonRequest('PUT', buildRecordUrl(overKey), { value: { data: 'y'.repeat(60) } }), {
        params: { installId, namespace, key: overKey },
      });
      expect(over.status).toBe(429);
      const overBody: any = await readJson(over);
      expect(overBody.error.code).toBe('QUOTA_EXCEEDED');
    } finally {
      spy.mockRestore();
    }
  });

  it('should reject requests without tenant credentials', async () => {
    mockAuth();

    const response = await listRecords(jsonRequest('GET', buildRecordsUrl(), undefined, { tenantHeader: null }), {
      params: { installId, namespace },
    });
    expect(response.status).toBe(401);
    const body: any = await readJson(response);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject requests for a different tenant', async () => {
    mockAuth();

    const response = await getRecord(jsonRequest('GET', buildRecordUrl('any-key'), undefined, { tenantHeader: 'other-tenant' }), {
      params: { installId, namespace, key: 'any-key' },
    });
    expect(response.status).toBe(401);
    const body: any = await readJson(response);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject when user lacks extension permission', async () => {
    mockAuth(false);

    const response = await listRecords(jsonRequest('GET', buildRecordsUrl(), undefined, { tenantHeader: tenantId }), {
      params: { installId, namespace },
    });
    expect(hasPermissionSpy).toHaveBeenCalled();
    expect(response.status).toBe(401);
    const body: any = await readJson(response);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
