/**
 * Route-level regression for the asset notes/software GETs on the x-api-key path
 * (C3 / alga-2026-0002683).
 *
 * `guardAssetReadForRequest` runs inside `runWithApiKeyOrSession`, which does NOT
 * establish an ambient tenant. The guard used to call
 * `AssetService.getAuthorizationRecord(id, ctx)` without a db, so
 * `getDbForContext` fell through to `createTenantKnex()` and threw
 * "No tenant found in current context" -> 500 for every asset. The earlier unit
 * tests mocked AssetService, which hid it.
 *
 * Here the real route handlers, real AssetService / getDbForContext / guard /
 * authorization kernel / API-key auth run against a migrated DB. Only the
 * connection factories (pointed at the test DB; there is deliberately no ambient
 * tenant), Next request plumbing and the rate limiter are stubbed.
 *
 * Run (see integration-testing skill for the cloned-DB recipe):
 *   cd server && REQUIRE_DB=1 TEST_DB_NAME=<clone> DB_HOST=127.0.0.1 DB_PORT=5474 \
 *     DB_USER_ADMIN=<role> DB_PASSWORD_ADMIN=<pw> \
 *     npx vitest run --config vitest.workspace-db.config.ts src/test/unit/api/assetReadGuardApiKey.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestApiKey } from '../../e2e/utils/apiTestHelpers';
import { createTestUserWithPermissions } from '../../e2e/utils/e2eTestSetup';

const connection = vi.hoisted(() => ({ db: undefined as Knex | undefined }));

vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  getConnection: async () => connection.db!,
  // No ambient tenant: a caller that relies on it gets tenant=null and throws.
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? null }),
}));
vi.mock('@alga-psa/auth', async (original) => {
  const actual = await original<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    // Session lookup is never reached on the API-key path (override wins).
    getSession: async () => null,
  };
});
vi.mock('@alga-psa/users/actions', async () => ({
  findUserByIdForApi: (await import('../../../../../packages/users/src/actions/user-actions/findUserByIdForApi')).findUserByIdForApi,
}));
vi.mock('@alga-psa/user-composition/lib/avatarUtils', () => ({ getUserAvatarUrl: async () => null }));
vi.mock('../../../lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

const notesRoute = await import('../../../app/api/v1/assets/[id]/notes/route');
const softwareRoute = await import('../../../app/api/v1/assets/[id]/software/route');

let db: Knex;
let tenant: string;
let otherTenant: string;
let ownAssetId: string;
let foreignAssetId: string;
let readerKey: string;
let noReadKey: string;

async function insertAsset(trx: Knex, t: string, clientId: string): Promise<string> {
  const assetId = randomUUID();
  await trx('assets').insert({
    tenant: t, asset_id: assetId, client_id: clientId, asset_type: 'workstation',
    asset_tag: `tag-${assetId}`, name: 'Scan target', status: 'active',
  });
  return assetId;
}

beforeAll(async () => {
  process.env.APP_ENV ||= 'test';
  db = await createTestDbConnection();
  tenant = (await db('tenants').first<{ tenant: string }>('tenant'))!.tenant;
}, 180_000);

beforeEach(async () => {
  const trx = await db.transaction();
  connection.db = trx;

  const clientId = randomUUID();
  await trx('clients').insert({ tenant, client_id: clientId, client_name: `Client ${clientId}` });
  ownAssetId = await insertAsset(trx, tenant, clientId);

  // Another tenant with its own asset.
  otherTenant = randomUUID();
  const tenantInfo = await trx('tenants').columnInfo();
  await trx('tenants').insert({
    tenant: otherTenant, email: `other-${otherTenant}@example.test`,
    ...(tenantInfo.company_name ? { company_name: `Tenant ${otherTenant}` } : { client_name: `Tenant ${otherTenant}` }),
  });
  const otherClientId = randomUUID();
  await trx('clients').insert({ tenant: otherTenant, client_id: otherClientId, client_name: `Client ${otherClientId}` });
  const statusRow = await trx('asset_statuses').where({ tenant, slug: 'active' }).first();
  if (statusRow) {
    await trx('asset_statuses').insert({ tenant: otherTenant, slug: 'active', label: 'Active', kind: 'deployable', is_builtin: true, is_active: true, display_order: 0 });
  }
  foreignAssetId = await insertAsset(trx, otherTenant, otherClientId);

  const readerId = await createTestUserWithPermissions(trx, tenant, ['asset:read']);
  readerKey = (await createTestApiKey(trx, readerId, tenant)).api_key;
  const noReadId = await createTestUserWithPermissions(trx, tenant, []);
  noReadKey = (await createTestApiKey(trx, noReadId, tenant)).api_key;
});
afterEach(async () => { await (connection.db as Knex.Transaction)?.rollback(); });
afterAll(async () => { await db?.destroy().catch(() => undefined); });

type Route = typeof notesRoute | typeof softwareRoute;
const routes: Array<{ name: string; path: string; handler: Route; assertOk: (body: any, id: string) => void }> = [
  {
    name: 'notes', path: 'notes', handler: notesRoute,
    assertOk: (body, id) => {
      expect(body.data).toEqual({ document: null, blockData: null, lastUpdated: null });
      expect(body._links).toEqual({
        self: { href: `/api/v1/assets/${id}/notes` },
        asset: { href: `/api/v1/assets/${id}` },
      });
    },
  },
  {
    name: 'software', path: 'software', handler: softwareRoute,
    assertOk: (body, id) => {
      expect(body.data).toEqual([]);
      expect(body.pagination).toMatchObject({ page: 1, limit: 50, total: 0 });
      expect(body._links.self.href).toBe(`/api/v1/assets/${id}/software`);
    },
  },
];

for (const route of routes) {
  describe(`GET /api/v1/assets/{id}/${route.name} with x-api-key`, () => {
    async function call(id: string, apiKey: string) {
      const request = new NextRequest(`http://localhost/api/v1/assets/${id}/${route.path}`, {
        headers: { 'x-api-key': apiKey, 'x-tenant-id': tenant },
      });
      const response = await route.handler.GET(request, { params: Promise.resolve({ id }) });
      return { status: response.status, body: await response.json() };
    }

    it('200s for an own-tenant asset', async () => {
      const { status, body } = await call(ownAssetId, readerKey);
      expect(status).toBe(200);
      route.assertOk(body, ownAssetId);
    });

    it('404s Asset not found for a non-existent id', async () => {
      const { status, body } = await call(randomUUID(), readerKey);
      expect(status).toBe(404);
      expect(body).toMatchObject({ error: { message: 'Asset not found', code: 'NOT_FOUND' } });
    });

    it("answers another tenant's asset with a 404 identical to the missing case", async () => {
      const missing = await call(randomUUID(), readerKey);
      const foreign = await call(foreignAssetId, readerKey);
      expect(foreign.status).toBe(404);
      expect(foreign.status).toBe(missing.status);
      // Byte-identical apart from the per-response meta.timestamp.
      const stable = (b: any) => JSON.stringify({ ...b, meta: { ...b.meta, timestamp: undefined } });
      expect(stable(foreign.body)).toBe(stable(missing.body));
      expect(foreign.body.error).toEqual({ message: 'Asset not found', code: 'NOT_FOUND' });
    });

    it('403s a key without asset:read before any load (even for a missing id)', async () => {
      for (const id of [ownAssetId, randomUUID()]) {
        const { status, body } = await call(id, noReadKey);
        expect(status).toBe(403);
        expect(JSON.stringify(body)).not.toContain('Asset not found');
      }
    });
  });
}
