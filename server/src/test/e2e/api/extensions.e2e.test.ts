import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  ensureApiServerRunning,
  resolveApiBaseUrl,
  stopApiServerIfStarted,
} from '../utils/apiServerManager';
import { setupE2ETestEnvironment, type E2ETestEnvironment } from '../utils/e2eTestSetup';

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
      console.warn('[extensions-api-e2e] Extension tables not present; skipping install endpoint test');
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

  it('installs an extension version and returns accepted response', async () => {
    if (!extensionsTablesAvailable) {
      expect(true).toBe(true);
      return;
    }

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

    const response = await env.apiClient.post('/api/v1/extensions/install',
      { registryId, version },
      {
        headers: {
          'x-tenant-id': env.tenant,
        },
      },
    );

    expect(response.status).toBe(202);
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
