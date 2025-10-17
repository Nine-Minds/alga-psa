import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import { parse } from 'node:url';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiTestClient, assertSuccess, assertError } from '../utils/apiTestHelpers';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { setupE2ETestEnvironment, type E2ETestEnvironment } from '../utils/e2eTestSetup';
import {
  STORAGE_NAMESPACE as namespace,
  configureStorageTestDatabase,
  ensureStorageTables,
  resetStorageTables,
} from './storage.helpers';
import { randomUUID } from 'node:crypto';

let tenantId = '';
let originalNextRuntime: string | undefined;
let originalSkipAppInit: string | undefined;
const cjsRequire = createRequire(import.meta.url);
let server: http.Server | null = null;
let baseUrl = '';
let apiClient: ApiTestClient;
let nextApp: any = null;
let testEnv: E2ETestEnvironment | null = null;

const recordsBasePath = () => `/api/v1/storage/namespaces/${namespace}/records`;
const recordPath = (key: string) => `${recordsBasePath()}/${encodeURIComponent(key)}`;

if (typeof (globalThis as any).AsyncLocalStorage === 'undefined') {
  (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
}

process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';

configureStorageTestDatabase();

describe('Storage API E2E Tests (real Next server)', () => {
  beforeAll(async () => {
    process.env.NEXT_TELEMETRY_DISABLED = process.env.NEXT_TELEMETRY_DISABLED ?? '1';
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    originalNextRuntime = process.env.NEXT_RUNTIME;
    originalSkipAppInit = process.env.E2E_SKIP_APP_INIT;
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.E2E_SKIP_APP_INIT = 'true';

    await ensureStorageTables();
    await resetStorageTables();

    const appDir = path.resolve(__dirname, '../../../../../server');
    const createNextServer = cjsRequire('next');
    nextApp = createNextServer({
      dev: true,
      dir: appDir,
      hostname: '127.0.0.1',
      port: 0,
    });
    await nextApp.prepare();
    const requestHandler = nextApp.getRequestHandler();

    server = http.createServer((req, res) => {
      const parsedUrl = parse(req.url ?? '', true);
      requestHandler(req, res, parsedUrl);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server!.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 180_000);

  afterAll(async () => {
    try {
      await resetStorageTables();
    } finally {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }).catch(() => undefined);
        server = null;
      }
      if (nextApp && typeof (nextApp as any).close === 'function') {
        await (nextApp as any).close().catch(() => undefined);
        nextApp = null;
      }
      if (originalNextRuntime === undefined) {
        delete process.env.NEXT_RUNTIME;
      } else {
        process.env.NEXT_RUNTIME = originalNextRuntime;
      }
      if (originalSkipAppInit === undefined) {
        delete process.env.E2E_SKIP_APP_INIT;
      } else {
        process.env.E2E_SKIP_APP_INIT = originalSkipAppInit;
      }
    }
  });

  beforeEach(async () => {
    testEnv = await setupE2ETestEnvironment({ baseUrl });
    tenantId = testEnv.tenant;
    apiClient = testEnv.apiClient;
    await ensureStoragePermissions(testEnv.db, testEnv.userId, tenantId);
    await resetStorageTables(tenantId);
  });

  afterEach(async () => {
    await testEnv?.cleanup();
    testEnv = null;
    await resetStorageTables();
  });

  describe('Record operations', () => {
    it('should create and retrieve a record via PUT/GET', async () => {
      const key = 'preferences';
      const payload = {
        value: { theme: 'dark', notifications: true },
        metadata: { contentType: 'application/json' },
      };

      const putResponse = await apiClient.put(recordPath(key), payload);
      assertSuccess(putResponse, 200);
      expect(putResponse.data).toMatchObject({
        namespace,
        key,
        revision: 1,
      });

      const getResponse = await apiClient.get(recordPath(key));
      assertSuccess(getResponse, 200);
      expect(getResponse.data.value).toEqual(payload.value);
      expect(getResponse.data.metadata).toEqual(payload.metadata);
    });

    it('should list records with optional value and metadata', async () => {
      const keys = ['list-one', 'list-two'];
      for (const key of keys) {
        await apiClient.put(recordPath(key), {
          value: { key },
          metadata: { index: key },
        });
      }

      const listResponse = await apiClient.get(recordsBasePath(), {
        params: {
          includeValues: true,
          includeMetadata: true,
          limit: 10,
        },
      });

      assertSuccess(listResponse, 200);
      expect(Array.isArray(listResponse.data.items)).toBe(true);
      expect(listResponse.data.items.length).toBeGreaterThanOrEqual(2);
      const returnedKeys = listResponse.data.items.map((item: any) => item.key);
      expect(returnedKeys).toEqual(expect.arrayContaining(keys));
      const sample = listResponse.data.items.find((item: any) => item.key === 'list-one');
      expect(sample.value).toEqual({ key: 'list-one' });
      expect(sample.metadata).toEqual({ index: 'list-one' });
    });

    it('should enforce optimistic concurrency', async () => {
      const key = 'revision-check';
      const initialResponse = await apiClient.put(recordPath(key), {
        value: { attempt: 1 },
      });
      assertSuccess(initialResponse, 200);
      expect(initialResponse.data.revision).toBe(1);

      const updateResponse = await apiClient.put(recordPath(key), {
        value: { attempt: 2 },
        ifRevision: initialResponse.data.revision,
      });
      assertSuccess(updateResponse, 200);
      expect(updateResponse.data.revision).toBe(2);

      const staleResponse = await apiClient.put(recordPath(key), {
        value: { attempt: 3 },
        ifRevision: 1,
      });
      assertError(staleResponse, 409, 'REVISION_MISMATCH');
    });

    it('should delete a record', async () => {
      const key = 'delete-me';
      await apiClient.put(recordPath(key), { value: { keep: false } });

      const deleteResponse = await apiClient.delete(recordPath(key));
      assertSuccess(deleteResponse, 204);

      const getResponse = await apiClient.get(recordPath(key));
      assertError(getResponse, 404, 'NOT_FOUND');
    });
  });

  describe('Bulk operations', () => {
    it('should insert multiple records with bulkPut', async () => {
      const bulkResponse = await apiClient.post(recordsBasePath(), {
        items: [
          { key: 'bulk-one', value: { id: 1 } },
          { key: 'bulk-two', value: { id: 2 }, metadata: { kind: 'pair' } },
        ],
      });

      assertSuccess(bulkResponse, 200);
      expect(bulkResponse.data.items).toHaveLength(2);

      const getOne = await apiClient.get(recordPath('bulk-one'));
      assertSuccess(getOne, 200);
      expect(getOne.data.value).toEqual({ id: 1 });

      const getTwo = await apiClient.get(recordPath('bulk-two'));
      assertSuccess(getTwo, 200);
      expect(getTwo.data.metadata).toEqual({ kind: 'pair' });
    });

    it('should enforce total storage quota', async () => {
      await apiClient.put(recordPath('quota-seed'), {
        value: { data: 'seed' },
      });

      const db = await createTestDbConnection();
      try {
        await db('storage_usage')
          .where({ tenant: tenantId })
          .update({ bytes_used: (256 * 1024 * 1024) - 16 });
      } finally {
        await db.destroy();
      }

      const overLimit = await apiClient.put(recordPath('quota-over'), {
        value: { data: 'x'.repeat(64) },
      });
      assertError(overLimit, 429, 'QUOTA_EXCEEDED');
    });
  });
});

async function ensureStoragePermissions(db: Awaited<ReturnType<typeof createTestDbConnection>>, userId: string, tenantId: string) {
  const userRole = await db('user_roles')
    .where({ user_id: userId, tenant: tenantId })
    .first<{ role_id: string }>();

  if (!userRole) {
    return;
  }

  const actions: Array<'read' | 'write'> = ['read', 'write'];

  for (const action of actions) {
    let permission = await db('permissions')
      .where({ tenant: tenantId, resource: 'storage', action })
      .first<{ permission_id: string }>();

    if (!permission) {
      const permissionId = randomUUID();
      await db('permissions').insert({
        tenant: tenantId,
        permission_id: permissionId,
        resource: 'storage',
        action,
      });
      permission = { permission_id: permissionId };
    }

    await db('role_permissions')
      .insert({
        tenant: tenantId,
        role_id: userRole.role_id,
        permission_id: permission.permission_id,
      })
      .catch((error: any) => {
        if (error?.code !== '23505') {
          throw error;
        }
      });
  }
}
