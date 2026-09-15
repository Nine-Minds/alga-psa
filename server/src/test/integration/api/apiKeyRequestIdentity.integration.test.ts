import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestApiKey } from '../../e2e/utils/apiTestHelpers';
import { withApiKeyAuth, withAuth, type ApiRequest } from '../../../lib/api/middleware/apiMiddleware';

const connection = vi.hoisted(() => ({ db: undefined as Knex | undefined }));

// Route connection factories to a disposable migrated DB. There is deliberately
// no ambient session tenant; key hashing, SQL validation and user loading are real.
vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  getConnection: async () => connection.db!,
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? null }),
}));
vi.mock('@alga-psa/auth', async () => ({
  ApiKeyService: (await import('../../../../../packages/auth/src/services/apiKeyService')).ApiKeyService,
}));
vi.mock('@alga-psa/users/actions', async () => ({
  findUserByIdForApi: (await import('../../../../../packages/users/src/actions/user-actions/findUserByIdForApi')).findUserByIdForApi,
}));
vi.mock('@alga-psa/user-composition/lib/avatarUtils', () => ({ getUserAvatarUrl: async () => null }));
vi.mock('../../../lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

let db: Knex;
let tenant: string;
let userId: string;
let key: Awaited<ReturnType<typeof createTestApiKey>>;

beforeAll(async () => {
  db = await createTestDbConnection();
  tenant = (await db('tenants').first<{ tenant: string }>('tenant'))!.tenant;
});
beforeEach(async () => {
  connection.db = await db.transaction();
  userId = randomUUID();
  await connection.db('users').insert({
    tenant, user_id: userId, username: `api-${userId}`, email: `${userId}@example.test`,
    first_name: 'API', last_name: 'Identity', hashed_password: 'api-only-test-user',
    user_type: 'internal', is_inactive: false,
  });
  key = await createTestApiKey(connection.db, userId, tenant);
});
afterEach(async () => { await (connection.db as Knex.Transaction)?.rollback(); });
afterAll(async () => { await db?.destroy(); });

for (const wrapper of ['withApiKeyAuth', 'withAuth'] as const) {
  describe(`${wrapper} request identity with real key storage`, () => {
    async function request(tenantHeader?: string) {
      const handler = vi.fn(async (req: ApiRequest) => NextResponse.json({
        tenant: req.context?.tenant, userId: req.context?.userId,
        userType: req.context?.user?.user_type, apiKeyId: req.context?.apiKeyId,
      }));
      const middleware = wrapper === 'withAuth' ? await withAuth(handler) : withApiKeyAuth()(handler);
      const headers: Record<string, string> = { 'x-api-key': key.api_key };
      if (tenantHeader !== undefined) headers['x-tenant-id'] = tenantHeader;
      const response = await middleware(new NextRequest('http://localhost/api/v1/users/search', { headers }));
      return { handler, response };
    }

    it.each([false, true])('authenticates without a browser session (tenant header: %s)', async (withTenant) => {
      const { response } = await request(withTenant ? tenant : undefined);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ tenant, userId, userType: 'internal', apiKeyId: key.api_key_id });
      expect((await connection.db!('api_keys').where({ tenant, api_key_id: key.api_key_id }).first()).last_used_at)
        .toBeInstanceOf(Date);
    });

    it('rejects a key presented for another tenant without invoking the handler or marking usage', async () => {
      const { handler, response } = await request(randomUUID());
      expect(response.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
      expect((await connection.db!('api_keys').where({ tenant, api_key_id: key.api_key_id }).first()).last_used_at).toBeNull();
    });

    it.each(['expired', 'revoked', 'inactive owner', 'client owner', 'suspended tenant', 'exhausted usage'] as const)(
      'rejects %s for both tenant header modes', async (reason) => {
        const trx = connection.db!;
        const keys = () => trx('api_keys').where({ tenant, api_key_id: key.api_key_id });
        if (reason === 'expired') await keys().update({ expires_at: new Date(0) });
        if (reason === 'revoked') await keys().update({ active: false });
        if (reason === 'exhausted usage') await keys().update({ usage_limit: 1, usage_count: 1 });
        if (reason === 'inactive owner') await trx('users').where({ tenant, user_id: userId }).update({ is_inactive: true });
        if (reason === 'client owner') await trx('users').where({ tenant, user_id: userId }).update({ user_type: 'client' });
        if (reason === 'suspended tenant') await trx('tenants').where({ tenant }).update({ suspended_at: new Date() });
        for (const tenantHeader of [undefined, tenant]) {
          // Both validation paths must reject the owner/limit themselves, even
          // if the first request lazily deactivated a legacy key.
          if (reason === 'client owner' || reason === 'exhausted usage') await keys().update({ active: true });
          const { response, handler } = await request(tenantHeader);
          expect(response.status).toBe(401);
          expect(handler).not.toHaveBeenCalled();
          expect((await keys().first()).last_used_at).toBeNull();
        }
      },
    );
  });
}
