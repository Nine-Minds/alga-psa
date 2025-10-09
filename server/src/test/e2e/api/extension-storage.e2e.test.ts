import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import {
  setupE2ETestEnvironment,
  E2ETestEnvironment,
} from '../utils/e2eTestSetup';
import {
  assertSuccess,
  assertError,
} from '../utils/apiTestHelpers';

describe('Extension Storage API E2E Tests', () => {
  let env: E2ETestEnvironment;
  let installId: string;
  let registryId: string;
  let versionId: string;
  const namespace = 'settings';
  let originalFlag: string | undefined;

  const recordsBasePath = () => `/api/ext-storage/install/${installId}/${namespace}/records`;
  const recordPath = (key: string) => `${recordsBasePath()}/${encodeURIComponent(key)}`;

  beforeAll(async () => {
    originalFlag = process.env.EXT_STORAGE_API_ENABLED;
    process.env.EXT_STORAGE_API_ENABLED = 'true';

    env = await setupE2ETestEnvironment();

    const db = env.db;
    registryId = uuidv4();
    versionId = uuidv4();
    installId = uuidv4();

    await db('extension_registry').insert({
      id: registryId,
      publisher: 'test-publisher',
      name: `storage-suite-${uuidv4()}`,
      display_name: 'Storage Test Extension',
      description: 'Extension storage E2E tests',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db('extension_version').insert({
      id: versionId,
      registry_id: registryId,
      version: '1.0.0',
      runtime: 'wasm-js@1',
      main_entry: 'dist/main.wasm',
      api: { endpoints: [] },
      api_endpoints: [],
      ui: null,
      capabilities: ['alga.storage'],
      created_at: new Date().toISOString(),
    });

    await db('tenant_extension_install').insert({
      id: installId,
      tenant_id: env.tenant,
      registry_id: registryId,
      version_id: versionId,
      status: 'enabled',
      granted_caps: [{ capability: 'alga.storage', access: ['read', 'write'], namespaces: [namespace] }],
      config: {},
      is_enabled: true,
      runner_domain: `storage-tests-${uuidv4()}.extensions.test`,
      runner_status: { state: 'ready' },
      runner_ref: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    try {
      if (env) {
        await env.db('ext_storage_records')
          .where({ tenant_id: env.tenant, extension_install_id: installId })
          .delete();
        await env.db('ext_storage_usage')
          .where({ tenant_id: env.tenant, extension_install_id: installId })
          .delete();
        await env.db('ext_storage_schemas')
          .where({ tenant_id: env.tenant, extension_install_id: installId })
          .delete();
        await env.db('tenant_extension_install')
          .where({ id: installId })
          .delete();
        await env.db('extension_version')
          .where({ id: versionId })
          .delete();
        await env.db('extension_registry')
          .where({ id: registryId })
          .delete();
      }
    } finally {
      if (env) {
        await env.cleanup();
      }
      if (originalFlag === undefined) {
        delete process.env.EXT_STORAGE_API_ENABLED;
      } else {
        process.env.EXT_STORAGE_API_ENABLED = originalFlag;
      }
    }
  });

  beforeEach(async () => {
    await env.db('ext_storage_records')
      .where({ tenant_id: env.tenant, extension_install_id: installId })
      .delete();
    await env.db('ext_storage_usage')
      .where({ tenant_id: env.tenant, extension_install_id: installId })
      .delete();
  });

  describe('Record operations', () => {
    it('should create and retrieve a record via PUT/GET', async () => {
      const key = 'preferences';
      const payload = {
        value: { theme: 'dark', notifications: true },
        metadata: { contentType: 'application/json' },
      };

      const putResponse = await env.apiClient.put(recordPath(key), payload);
      assertSuccess(putResponse, 200);
      expect(putResponse.data).toMatchObject({
        namespace,
        key,
        revision: 1,
      });

      const getResponse = await env.apiClient.get(recordPath(key));
      assertSuccess(getResponse, 200);
      expect(getResponse.data.value).toEqual(payload.value);
      expect(getResponse.data.metadata).toEqual(payload.metadata);
    });

    it('should list records with optional value and metadata', async () => {
      const keys = ['list-one', 'list-two'];
      for (const key of keys) {
        await env.apiClient.put(recordPath(key), {
          value: { key },
          metadata: { index: key },
        });
      }

      const listResponse = await env.apiClient.get(recordsBasePath(), {
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
      const initial = await env.apiClient.put(recordPath(key), {
        value: { attempt: 1 },
      });
      assertSuccess(initial, 200);
      expect(initial.data.revision).toBe(1);

      const update = await env.apiClient.put(recordPath(key), {
        value: { attempt: 2 },
        ifRevision: initial.data.revision,
      });
      assertSuccess(update, 200);
      expect(update.data.revision).toBe(2);

      const stale = await env.apiClient.put(recordPath(key), {
        value: { attempt: 3 },
        ifRevision: 1,
      });
      assertError(stale, 409, 'REVISION_MISMATCH');
    });

    it('should delete a record', async () => {
      const key = 'delete-me';
      await env.apiClient.put(recordPath(key), {
        value: { keep: false },
      });

      const deleteResponse = await env.apiClient.delete(recordPath(key));
      assertSuccess(deleteResponse, 204);

      const getResponse = await env.apiClient.get(recordPath(key));
      assertError(getResponse, 404, 'NOT_FOUND');
    });
  });

  describe('Bulk operations', () => {
    it('should insert multiple records with bulkPut', async () => {
      const bulkResponse = await env.apiClient.post(recordsBasePath(), {
        items: [
          { key: 'bulk-one', value: { id: 1 } },
          { key: 'bulk-two', value: { id: 2 }, metadata: { kind: 'pair' } },
        ],
      });

      assertSuccess(bulkResponse, 200);
      expect(bulkResponse.data.items).toHaveLength(2);

      const getOne = await env.apiClient.get(recordPath('bulk-one'));
      assertSuccess(getOne, 200);
      expect(getOne.data.value).toEqual({ id: 1 });

      const getTwo = await env.apiClient.get(recordPath('bulk-two'));
      assertSuccess(getTwo, 200);
      expect(getTwo.data.metadata).toEqual({ kind: 'pair' });
    });
  });
});
