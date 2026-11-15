import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tenantDb } from '@alga-psa/db';
import { setupE2ETestEnvironment, E2ETestEnvironment } from '../utils/e2eTestSetup';
import { ApiTestClient, assertError, assertSuccess, createTestApiKey } from '../utils/apiTestHelpers';
import { createUser } from '../../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../../migrations/utils/permissions');
const { DEFAULT_ROLES } = require(path.join(permissionsDir, 'roleGrants.cjs'));
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));

/**
 * The default harness user holds a hand-built "Test Admin" role, which is why
 * /roles passed here while a real Admin key got 403 in production. These tests
 * provision the tenant from the permission catalog instead, and key a real
 * Admin and a real Technician.
 */
const ENDPOINTS = [
  '/api/v1/meta/openapi',
  '/api/v1/roles',
  '/api/v1/webhooks',
  '/api/v1/rbac/audit',
];

describe('Admin-only API endpoints (catalog-provisioned roles)', () => {
  let env: E2ETestEnvironment;
  let adminClient: ApiTestClient;
  let technicianClient: ApiTestClient;

  async function keyedClient(roleName: string): Promise<ApiTestClient> {
    const table = (name: string) => tenantDb(env.db, env.tenant).table(name);
    const userId = await createUser(env.db, env.tenant, { username: `catalog.${roleName.toLowerCase()}.${Date.now()}` });
    const role = await table('roles').where({ role_name: roleName, msp: true }).first('role_id') as { role_id: string };
    await table('user_roles').insert({ tenant: env.tenant, user_id: userId, role_id: role.role_id });
    const key = await createTestApiKey(env.db, userId, env.tenant, `${roleName} catalog key`);
    return new ApiTestClient({ baseUrl: process.env.TEST_API_BASE_URL as string, apiKey: key.api_key });
  }

  beforeAll(async () => {
    env = await setupE2ETestEnvironment({ clientName: 'API Admin Endpoints Client', userName: 'api_admin_endpoints' });
    const table = (name: string) => tenantDb(env.db, env.tenant).table(name);
    const product = ((await env.db('tenants').where({ tenant: env.tenant }).first('product_code')) as any)?.product_code ?? 'psa';
    await table('roles').insert(DEFAULT_ROLES[product]
      .filter((role: any) => !role.legacy && role.msp)
      .map((role: any) => ({
        tenant: env.tenant, role_name: role.roleName, description: role.roleName, msp: role.msp, client: role.client,
      })));
    await syncPermissionCatalog(env.db, env.tenant, product);
    adminClient = await keyedClient('Admin');
    technicianClient = await keyedClient(product === 'algadesk' ? 'Agent' : 'Technician');
  }, 120_000);

  afterAll(async () => {
    await env.cleanup();
  });

  it.each(ENDPOINTS)('Admin API key gets 200 on %s', async (endpoint) => {
    assertSuccess(await adminClient.get(endpoint), 200);
  });

  it.each(ENDPOINTS)('non-admin API key gets 403 on %s', async (endpoint) => {
    assertError(await technicianClient.get(endpoint), 403);
  });
});
