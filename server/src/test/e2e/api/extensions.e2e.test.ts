import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  ensureApiServerRunning,
  resolveApiBaseUrl,
  stopApiServerIfStarted,
} from '../utils/apiServerManager';
import { setupE2ETestEnvironment, type E2ETestEnvironment } from '../utils/e2eTestSetup';
import { grantTestUserPermission, withoutTestUserPermission } from '../utils/simpleRoleSetup';

const apiBaseUrl = resolveApiBaseUrl(process.env.TEST_API_BASE_URL);

describe('Extensions API – Install endpoint', () => {
  let env: E2ETestEnvironment;
  const registryIds: string[] = [];
  let extensionsTablesAvailable = false;

  beforeAll(async () => {
    await ensureApiServerRunning(apiBaseUrl);
    env = await setupE2ETestEnvironment({
      baseUrl: apiBaseUrl,
      clientName: 'Extensions API Test Client',
      userName: 'extensions_api_test_user',
    });

    const [hasRegistry, hasVersion, hasInstall, hasInstallConfig] = await Promise.all([
      env.db.schema.hasTable('extension_registry'),
      env.db.schema.hasTable('extension_version'),
      env.db.schema.hasTable('tenant_extension_install'),
      env.db.schema.hasTable('tenant_extension_install_config'),
    ]);

    extensionsTablesAvailable = hasRegistry && hasVersion && hasInstall && hasInstallConfig;
    if (!extensionsTablesAvailable) {
      if (process.env.E2E_EDITION !== 'community') throw new Error('Enterprise extension tables are required');
    }
  }, 120_000);

  afterEach(async () => {
    if (!env) return;
    if (!extensionsTablesAvailable) return;
    for (const registryId of registryIds.splice(0)) {
      try {
        const installRows = await env.db('tenant_extension_install')
          .where({ tenant_id: env.tenant, registry_id: registryId })
          .select('id');

        const hasSecrets = await env.db.schema.hasTable('tenant_extension_install_secrets');
        const hasConfig = await env.db.schema.hasTable('tenant_extension_install_config');
        for (const row of installRows) {
          if (hasConfig) {
            await env.db('tenant_extension_install_config').where({ install_id: row.id }).delete();
          }
          if (hasSecrets) {
            await env.db('tenant_extension_install_secrets').where({ install_id: row.id }).delete();
          }
        }

        await env.db('tenant_extension_install').where({ tenant_id: env.tenant, registry_id: registryId }).delete();
        await env.db('extension_version').where({ registry_id: registryId }).delete();
        await env.db('extension_registry').where({ id: registryId }).delete();
      } catch (error) {
        console.warn('Failed to cleanup extension test data', { registryId, error });
      }
    }
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
    await stopApiServerIfStarted();
  }, 60_000);

  it('enforces edition availability and installs an enterprise extension version', async () => {
    if (process.env.E2E_EDITION === 'community') {
      const response = await env.apiClient.post('/api/v1/extensions/install', { registryId: randomUUID(), version: '1.0.0' });
      expect(response.status, JSON.stringify(response.data)).toBe(501);
      expect(response.data).toEqual({ error: 'Extension installation API is only available in the Enterprise Edition.' });
      return;
    }
    expect(extensionsTablesAvailable).toBe(true);
    await grantTestUserPermission(env.db, env.userId, env.tenant, 'extension', 'write');

    const registryId = randomUUID();
    const versionId = randomUUID();
    const version = '1.0.0';

    registryIds.push(registryId);

    await env.db('extension_registry').insert({
      id: registryId,
      publisher: 'test-publisher',
      name: 'extension-e2e',
      display_name: 'Extension E2E',
      description: 'E2E extension registry entry',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await env.db('extension_version').insert({
      id: versionId,
      registry_id: registryId,
      version,
      runtime: 'component',
      main_entry: 'component.wasm',
      api: JSON.stringify({}),
      ui: null,
      capabilities: JSON.stringify(['cap:context.read']),
      created_at: new Date(),
    });

    await withoutTestUserPermission(env.db, env.userId, env.tenant, 'extension', 'write', async () => {
      const denied = await env.apiClient.post('/api/v1/extensions/install', { registryId, version });
      expect(denied.status, JSON.stringify(denied.data)).toBe(403);
      expect(denied.data).toMatchObject({ error: { message: 'Permission denied: Cannot write extension' } });
      expect(await env.db('tenant_extension_install').where({ tenant_id: env.tenant, registry_id: registryId }).first()).toBeUndefined();
    });

    // API-key requests have no browser session. Licensing must use the
    // authenticated tenant, and still refuse installations on a lower tier.
    const tenantRow = await env.db('tenants').where({ tenant: env.tenant }).first();
    await env.db('tenants').where({ tenant: env.tenant }).update({ plan: 'essentials' });
    try {
      const denied = await env.apiClient.post('/api/v1/extensions/install', { registryId, version });
      expect(denied.status, JSON.stringify(denied.data)).toBe(403);
      expect(denied.data).toMatchObject({ error: { code: 'TIER_ACCESS_DENIED' } });
      expect(await env.db('tenant_extension_install').where({ tenant_id: env.tenant, registry_id: registryId }).first()).toBeUndefined();
    } finally {
      await env.db('tenants').where({ tenant: env.tenant }).update({ plan: tenantRow.plan });
    }

    const response = await env.apiClient.post('/api/v1/extensions/install',
      { registryId, version },
      {
        headers: {
          'x-tenant-id': env.tenant,
        },
      },
    );

    expect(response.status, JSON.stringify(response.data)).toBe(202);
    expect(response.ok).toBe(true);

    const payload = response.data as { data?: any };
    expect(payload?.data?.success).toBe(true);
    expect(payload?.data?.installId).toBeTruthy();

    const installRow = await env.db('tenant_extension_install')
      .where({ tenant_id: env.tenant, registry_id: registryId })
      .first();

    expect(installRow).toBeTruthy();
    expect(installRow?.version_id).toBe(versionId);

    const configRow = await env.db('tenant_extension_install_config')
      .where({ install_id: installRow?.id })
      .first();

    expect(configRow).toBeTruthy();
    expect(configRow?.tenant_id).toBe(env.tenant);
  }, 60_000);
});
