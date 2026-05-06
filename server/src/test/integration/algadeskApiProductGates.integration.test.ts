import { afterAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

function hashApiKey(plainTextKey: string): string {
  return createHash('sha256').update(plainTextKey).digest('hex');
}

describe('algadesk API key product gates (integration)', () => {
  let db: Knex | null = null;

  afterAll(async () => {
    await db?.destroy();
  });

  it('RT011: allows representative Algadesk endpoints and denies PSA-only endpoints with structured 403', async () => {
    process.env.DB_NAME_SERVER = 'test_database';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    const { ApiBaseController } = await import('@/lib/api/controllers/ApiBaseController');
    class ApiGateTestController extends ApiBaseController {
      protected override async checkPermission(): Promise<void> {
        return;
      }

      public listHandler() {
        return this.list();
      }
    }

    db = await createTestDbConnection({ runSeeds: false });

    const tenantId = randomUUID();
    const userId = randomUUID();
    const apiKeyId = randomUUID();
    const plainApiKey = `algadesk-rt011-${randomUUID()}`;

    const tenantColumns = await db('tenants').columnInfo();
    const userColumns = await db('users').columnInfo();
    const apiKeyColumns = await db('api_keys').columnInfo();

    await db('tenants').insert({
      tenant: tenantId,
      ...(Object.prototype.hasOwnProperty.call(tenantColumns, 'company_name')
        ? { company_name: 'Algadesk RT011 Tenant' }
        : { client_name: 'Algadesk RT011 Tenant' }),
      email: `tenant-${tenantId.slice(0, 8)}@example.com`,
      product_code: 'algadesk',
      ...(Object.prototype.hasOwnProperty.call(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(Object.prototype.hasOwnProperty.call(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    await db('users').insert({
      tenant: tenantId,
      user_id: userId,
      username: `algadesk-rt011-${tenantId.slice(0, 8)}`,
      hashed_password: 'unused',
      ...(Object.prototype.hasOwnProperty.call(userColumns, 'role') ? { role: 'admin' } : {}),
      ...(Object.prototype.hasOwnProperty.call(userColumns, 'email') ? { email: `user-${tenantId.slice(0, 8)}@example.com` } : {}),
      ...(Object.prototype.hasOwnProperty.call(userColumns, 'user_type') ? { user_type: 'internal' } : {}),
      ...(Object.prototype.hasOwnProperty.call(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(Object.prototype.hasOwnProperty.call(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    await db('api_keys').insert({
      api_key_id: apiKeyId,
      tenant: tenantId,
      user_id: userId,
      api_key: hashApiKey(plainApiKey),
      description: 'RT011 API key',
      active: true,
      ...(Object.prototype.hasOwnProperty.call(apiKeyColumns, 'usage_count') ? { usage_count: 0 } : {}),
      ...(Object.prototype.hasOwnProperty.call(apiKeyColumns, 'usage_limit') ? { usage_limit: null } : {}),
      ...(Object.prototype.hasOwnProperty.call(apiKeyColumns, 'last_used_at') ? { last_used_at: null } : {}),
      ...(Object.prototype.hasOwnProperty.call(apiKeyColumns, 'expires_at') ? { expires_at: null } : {}),
      ...(Object.prototype.hasOwnProperty.call(apiKeyColumns, 'purpose') ? { purpose: 'integration_test' } : {}),
      ...(Object.prototype.hasOwnProperty.call(apiKeyColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(Object.prototype.hasOwnProperty.call(apiKeyColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    const controller = new ApiGateTestController(
      { list: async () => ({ data: [], total: 0 }) } as any,
      { resource: 'ticket' },
    );
    const handler = controller.listHandler();

    const makeRequest = (path: string) =>
      new NextRequest(`http://localhost${path}`, {
        method: 'GET',
        headers: {
          'x-api-key': plainApiKey,
          'x-tenant-id': tenantId,
        },
      });

    const allowedResponse = await handler(makeRequest('/api/v1/tickets'));
    expect(allowedResponse.status).toBe(200);

    const deniedPaths = ['/api/v1/projects', '/api/v1/financial', '/api/v1/assets', '/api/chat/stream/title'];
    for (const deniedPath of deniedPaths) {
      const deniedResponse = await handler(makeRequest(deniedPath));
      expect(deniedResponse.status).toBe(403);
      const deniedBody = await deniedResponse.json();
      expect(deniedBody.error?.code).toBe('PRODUCT_ACCESS_DENIED');
    }

    await db('api_keys').where({ tenant: tenantId }).del();
    await db('users').where({ tenant: tenantId }).del();
    await db('tenants').where({ tenant: tenantId }).del();
  }, 180_000);
});
