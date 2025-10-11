import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AsyncLocalStorage } from 'node:async_hooks';

import { TestContext } from '../../../server/test-utils/testContext';
import {
  STORAGE_NAMESPACE as namespace,
  configureExtensionStorageTestDatabase,
  ensureExtensionStorageTables,
  seedExtensionData,
} from '../../../server/src/test/e2e/api/extension-storage.helpers';

import { GET as getRecord, PUT as putRecord } from '../record';
import { GET as listRecords, POST as bulkPutRecords } from '../records';
import * as userActions from 'server/src/lib/actions/user-actions/userActions';
import * as rbac from 'server/src/lib/auth/rbac';

if (typeof (globalThis as any).AsyncLocalStorage === 'undefined') {
  (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
}

process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
process.env.EXT_STORAGE_API_ENABLED = 'true';
process.env.EDITION = 'ee';
process.env.NEXT_PUBLIC_EDITION = 'enterprise';

configureExtensionStorageTestDatabase();

describe('product-extension-storage-api handlers (edge cases)', () => {
  const testHelpers = TestContext.createHelpers();
  const origin = 'http://127.0.0.1';

  let tenantId = '';
  let installId = '';
  let getCurrentUserSpy: ReturnType<typeof vi.spyOn> | null = null;
  let hasPermissionSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeAll(async () => {
    const ctx = await testHelpers.beforeAll();
    tenantId = ctx.tenantId;
    await ensureExtensionStorageTables();
    const seed = await seedExtensionData(tenantId, namespace);
    installId = seed.installId;
  }, 180_000);

  afterAll(async () => {
    await testHelpers.afterAll();
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
    return (await response.clone().json()) as T;
  }

  it('GET should honor If-Revision-Match header', async () => {
    mockAuth();
    const key = 'if-rev-get';
    const put = await putRecord(jsonRequest('PUT', buildRecordUrl(key), { value: { n: 1 } }), {
      params: { installId, namespace, key },
    });
    expect(put.status).toBe(200);
    const putBody: any = await readJson(put);
    expect(putBody.revision).toBe(1);

    const get = await getRecord(
      jsonRequest('GET', buildRecordUrl(key), undefined, { headers: { 'if-revision-match': '2' } }),
      { params: { installId, namespace, key } },
    );
    // Expect a 409 when header does not match stored revision
    expect(get.status).toBe(409);
    const body: any = await readJson(get);
    expect(body.error.code).toBe('REVISION_MISMATCH');
  });

  it('list should reject malformed cursor', async () => {
    mockAuth();
    const cursor = Buffer.from(JSON.stringify({}), 'utf8').toString('base64url');
    const res = await listRecords(jsonRequest('GET', buildRecordsUrl({ cursor })), {
      params: { installId, namespace },
    });
    expect(res.status).toBe(400);
    const body: any = await readJson(res);
    expect(body.error?.code ?? body.error).toMatch(/VALIDATION/i);
  });

  it('bulkPut should enforce per-item ifRevision', async () => {
    mockAuth();
    const seed = await putRecord(jsonRequest('PUT', buildRecordUrl('bulk-if-rev'), { value: { v: 1 } }), {
      params: { installId, namespace, key: 'bulk-if-rev' },
    });
    expect(seed.status).toBe(200);

    const bulk = await bulkPutRecords(
      jsonRequest('POST', buildRecordsUrl(), {
        items: [
          { key: 'bulk-if-rev', value: { v: 2 }, ifRevision: 999 }, // stale
        ],
      }),
      { params: { installId, namespace } },
    );
    expect(bulk.status).toBe(409);
    const body: any = await readJson(bulk);
    expect(body.error.code).toBe('REVISION_MISMATCH');
  });

  it('list keyPrefix should treat % literally (no wildcard injection)', async () => {
    mockAuth();
    await putRecord(jsonRequest('PUT', buildRecordUrl('ab%1'), { value: { x: 1 } }), {
      params: { installId, namespace, key: 'ab%1' },
    });
    await putRecord(jsonRequest('PUT', buildRecordUrl('abX'), { value: { x: 2 } }), {
      params: { installId, namespace, key: 'abX' },
    });

    const res = await listRecords(
      jsonRequest('GET', buildRecordsUrl({ keyPrefix: 'ab%', limit: 10 })),
      { params: { installId, namespace } },
    );
    expect(res.status).toBe(200);
    const body: any = await readJson(res);
    const keys = body.items.map((i: any) => i.key);
    expect(keys).toEqual(['ab%1']);
  });
});
