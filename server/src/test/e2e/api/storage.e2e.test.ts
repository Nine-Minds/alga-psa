import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { ApiTestClient, assertSuccess, assertError } from '../utils/apiTestHelpers';
import { setupE2ETestEnvironment, type E2ETestEnvironment } from '../utils/e2eTestSetup';
import { randomUUID } from 'node:crypto';

const namespace = 'settings';
let tenantId = '';
let apiClient: ApiTestClient;
let testEnv: E2ETestEnvironment | null = null;
const recordsBasePath = () => `/api/v1/storage/namespaces/${namespace}/records`;
const recordPath = (key: string) => `${recordsBasePath()}/${encodeURIComponent(key)}`;

describe('Storage API E2E Tests (built application)', () => {
  beforeEach(async () => {
    testEnv = await setupE2ETestEnvironment();
    tenantId = testEnv.tenant;
    apiClient = testEnv.apiClient;
    await ensureStoragePermissions(testEnv.db, testEnv.userId, tenantId);
  });
  afterEach(async () => {
    if (!testEnv) return;
    try {
      for (const table of ['storage_records', 'storage_schemas', 'storage_usage']) {
        await testEnv.db(table).where({ tenant: tenantId }).delete();
      }
    } finally {
      await testEnv.cleanup();
      testEnv = null;
    }
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

      await testEnv!.db('storage_usage')
        .where({ tenant: tenantId })
        .update({ bytes_used: (256 * 1024 * 1024) - 16 });

      const overLimit = await apiClient.put(recordPath('quota-over'), {
        value: { data: 'x'.repeat(64) },
      });
      assertError(overLimit, 429, 'QUOTA_EXCEEDED');
    });
  });
});

async function ensureStoragePermissions(db: Knex, userId: string, tenantId: string) {
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
