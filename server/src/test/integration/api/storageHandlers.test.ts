import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AsyncLocalStorage } from 'node:async_hooks';

import { TestContext } from '../../../../test-utils/testContext';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import {
  STORAGE_NAMESPACE as namespace,
  configureStorageTestDatabase,
  ensureStorageTables,
  resetStorageTables,
} from '../../e2e/api/storage.helpers';
import { GET as getRecordHandler, PUT as putRecordHandler, DELETE as deleteRecordHandler } from '../../../app/api/v1/storage/namespaces/[namespace]/records/[key]/route';
import { GET as listRecordsHandler, POST as bulkPutHandler } from '../../../app/api/v1/storage/namespaces/[namespace]/records/route';
import { StorageService } from '@/lib/storage/api/service';
import * as storageFactory from '@/lib/storage/api/factory';
import * as userActions from '@alga-psa/users/actions';
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

configureStorageTestDatabase();

describe('Storage Route Handlers', () => {
  const testHelpers = TestContext.createHelpers();
  const origin = 'http://127.0.0.1';

  let tenantId = '';
  let getCurrentUserSpy: ReturnType<typeof vi.spyOn> | null = null;
  let hasPermissionSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeAll(async () => {
    const ctx = await testHelpers.beforeAll();
    tenantId = ctx.tenantId;
    await ensureStorageTables();
    await resetStorageTables();
  }, 120_000);

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  beforeEach(async () => {
    const ctx = await testHelpers.beforeEach();
    tenantId = ctx.tenantId;
    await resetStorageTables(tenantId);
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
    const url = new URL(`/api/v1/storage/namespaces/${namespace}/records`, origin);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  function buildRecordUrl(key: string): string {
    return `${origin}/api/v1/storage/namespaces/${namespace}/records/${encodeURIComponent(key)}`;
  }

  function jsonRequest(
    method: string,
    url: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): NextRequest {
    const headers = new Headers(options?.headers ?? {});
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

    const putResponse = await putRecordHandler(jsonRequest('PUT', buildRecordUrl(key), payload), {
      params: { namespace, key },
    });
    expect(putResponse.status).toBe(200);
    const putData: any = await readJson(putResponse);
    expect(putData).toMatchObject({ namespace, key, revision: 1 });

    const getResponse = await getRecordHandler(jsonRequest('GET', buildRecordUrl(key)), {
      params: { namespace, key },
    });
    expect(getResponse.status).toBe(200);
    const getData: any = await readJson(getResponse);
    expect(getData.value).toEqual(payload.value);
    expect(getData.metadata).toEqual(payload.metadata);
  });

  it('should list records with optional value and metadata', async () => {
    mockAuth();

    await putRecordHandler(jsonRequest('PUT', buildRecordUrl('list-one'), { value: { id: 1 }, metadata: { marker: 'one' } }), {
      params: { namespace, key: 'list-one' },
    });
    await putRecordHandler(jsonRequest('PUT', buildRecordUrl('list-two'), { value: { id: 2 }, metadata: { marker: 'two' } }), {
      params: { namespace, key: 'list-two' },
    });

    const listResponse = await listRecordsHandler(
      jsonRequest('GET', buildRecordsUrl({ includeValues: true, includeMetadata: true, limit: 10 })),
      { params: { namespace } },
    );
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

    const initial = await putRecordHandler(jsonRequest('PUT', buildRecordUrl(key), { value: { step: 1 } }), {
      params: { namespace, key },
    });
    expect(initial.status).toBe(200);
    const firstData: any = await readJson(initial);
    expect(firstData.revision).toBe(1);

    const update = await putRecordHandler(
      jsonRequest('PUT', buildRecordUrl(key), { value: { step: 2 }, ifRevision: firstData.revision }),
      {
        params: { namespace, key },
      },
    );
    expect(update.status).toBe(200);
    const secondData: any = await readJson(update);
    expect(secondData.revision).toBe(2);

    const stale = await putRecordHandler(jsonRequest('PUT', buildRecordUrl(key), { value: { step: 3 }, ifRevision: 1 }), {
      params: { namespace, key },
    });
    expect(stale.status).toBe(409);
    const staleBody: any = await readJson(stale);
    expect(staleBody.error.code).toBe('REVISION_MISMATCH');
  });

  it('should delete a record', async () => {
    mockAuth();

    const key = 'delete-me';
    await putRecordHandler(jsonRequest('PUT', buildRecordUrl(key), { value: { active: true } }), {
      params: { namespace, key },
    });

    const deleteResponse = await deleteRecordHandler(jsonRequest('DELETE', buildRecordUrl(key)), {
      params: { namespace, key },
    });
    expect(deleteResponse.status).toBe(204);
    const text = await deleteResponse.text();
    expect(text).toBe('');

    const missing = await getRecordHandler(jsonRequest('GET', buildRecordUrl(key)), {
      params: { namespace, key },
    });
    expect(missing.status).toBe(404);
    const missingBody: any = await readJson(missing);
    expect(missingBody.error.code).toBe('NOT_FOUND');
  });

  it('should insert multiple records with bulkPut', async () => {
    mockAuth();

    const bulkResponse = await bulkPutHandler(
      jsonRequest('POST', buildRecordsUrl(), {
        items: [
          { key: 'bulk-one', value: { id: 1 } },
          { key: 'bulk-two', value: { id: 2 }, metadata: { label: 'two' } },
        ],
      }),
      { params: { namespace } },
    );
    expect(bulkResponse.status).toBe(200);
    const bulkData: any = await readJson(bulkResponse);
    expect(bulkData.items).toHaveLength(2);

    const first = await getRecordHandler(jsonRequest('GET', buildRecordUrl('bulk-one')), {
      params: { namespace, key: 'bulk-one' },
    });
    expect(first.status).toBe(200);
    const firstBody: any = await readJson(first);
    expect(firstBody.value).toEqual({ id: 1 });

    const second = await getRecordHandler(jsonRequest('GET', buildRecordUrl('bulk-two')), {
      params: { namespace, key: 'bulk-two' },
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

    const original = storageFactory.getStorageServiceForTenant;
    const spy = vi.spyOn(storageFactory, 'getStorageServiceForTenant').mockImplementation(async (tenantIdArg) => {
      const context = await original(tenantIdArg);
      return {
        ...context,
        service: new StorageService(context.knex, context.tenantId, quota),
      };
    });

    try {
      const seedKey = 'quota-seed';
      const first = await putRecordHandler(jsonRequest('PUT', buildRecordUrl(seedKey), { value: { data: 'x'.repeat(40) } }), {
        params: { namespace, key: seedKey },
      });
      expect(first.status).toBe(200);

      const overKey = 'quota-over';
      const over = await putRecordHandler(jsonRequest('PUT', buildRecordUrl(overKey), { value: { data: 'y'.repeat(60) } }), {
        params: { namespace, key: overKey },
      });
      expect(over.status).toBe(429);
      const overBody: any = await readJson(over);
      expect(overBody.error.code).toBe('QUOTA_EXCEEDED');
    } finally {
      spy.mockRestore();
    }
  });

  it('should reject requests without tenant credentials', async () => {
    getCurrentUserSpy = vi.spyOn(userActions, 'getCurrentUser').mockResolvedValue(null);
    const response = await listRecordsHandler(jsonRequest('GET', buildRecordsUrl()), {
      params: { namespace },
    });
    expect(response.status).toBe(401);
    const body: any = await readJson(response);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject requests for a different tenant', async () => {
    mockAuth();
    const key = 'tenant-isolated';
    await putRecordHandler(jsonRequest('PUT', buildRecordUrl(key), { value: { v: 1 } }), {
      params: { namespace, key },
    });
    mockAuth(true, '11111111-1111-1111-1111-111111111111');

    const response = await getRecordHandler(jsonRequest('GET', buildRecordUrl(key)), {
      params: { namespace, key },
    });
    expect(response.status).toBe(404);
    const body: any = await readJson(response);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('should reject when user lacks storage permission', async () => {
    mockAuth(false);

    const response = await listRecordsHandler(jsonRequest('GET', buildRecordsUrl()), {
      params: { namespace },
    });
    expect(hasPermissionSpy).toHaveBeenCalled();
    expect(response.status).toBe(401);
    const body: any = await readJson(response);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should surface latest revision and enforce conditional guards', async () => {
    mockAuth();

    const key = 'revision-visibility';

    const first = await putRecordHandler(
      jsonRequest('PUT', buildRecordUrl(key), { value: { version: 1 } }),
      { params: { namespace, key } },
    );
    expect(first.status).toBe(200);
    const firstBody: any = await readJson(first);
    expect(firstBody.revision).toBe(1);

    const second = await putRecordHandler(
      jsonRequest('PUT', buildRecordUrl(key), { value: { version: 2 } }),
      { params: { namespace, key } },
    );
    expect(second.status).toBe(200);
    const secondBody: any = await readJson(second);
    expect(secondBody.revision).toBe(2);

    const current = await getRecordHandler(jsonRequest('GET', buildRecordUrl(key)), {
      params: { namespace, key },
    });
    expect(current.status).toBe(200);
    const currentBody: any = await readJson(current);
    expect(currentBody.revision).toBe(2);
    expect(currentBody.value).toEqual({ version: 2 });

    const staleRead = await getRecordHandler(
      jsonRequest('GET', buildRecordUrl(key), undefined, { headers: { 'if-revision-match': '1' } }),
      { params: { namespace, key } },
    );
    expect(staleRead.status).toBe(409);
    const staleBody: any = await readJson(staleRead);
    expect(staleBody.error.code).toBe('REVISION_MISMATCH');

    const guardedRead = await getRecordHandler(
      jsonRequest('GET', buildRecordUrl(key), undefined, { headers: { 'if-revision-match': '2' } }),
      { params: { namespace, key } },
    );
    expect(guardedRead.status).toBe(200);
    const guardedBody: any = await readJson(guardedRead);
    expect(guardedBody.revision).toBe(2);

    const staleDelete = await deleteRecordHandler(
      jsonRequest('DELETE', `${buildRecordUrl(key)}?ifRevision=1`),
      { params: { namespace, key } },
    );
    expect(staleDelete.status).toBe(409);
    const staleDeleteBody: any = await readJson(staleDelete);
    expect(staleDeleteBody.error.code).toBe('REVISION_MISMATCH');

    const deleteResponse = await deleteRecordHandler(
      jsonRequest('DELETE', `${buildRecordUrl(key)}?ifRevision=2`),
      { params: { namespace, key } },
    );
    expect(deleteResponse.status).toBe(204);

    const missing = await getRecordHandler(jsonRequest('GET', buildRecordUrl(key)), {
      params: { namespace, key },
    });
    expect(missing.status).toBe(404);
    const missingBody: any = await readJson(missing);
    expect(missingBody.error.code).toBe('NOT_FOUND');
  });
});
