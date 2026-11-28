/**
 * Route-level regression for GET /api/v1/software/search on the x-api-key path
 * (alga-2026-0003306). The route used to call the `withAuth`-wrapped
 * `searchSoftwareFleetWide` directly, so an API-key request (no session) threw
 * AuthenticationError, which the catch-all turned into a 500.
 *
 * The real route handler, real action, real `withAuth`, real API-key auth and
 * the real authorization kernel run against a migrated DB. Only the connection
 * factories (pointed at the test DB; no ambient tenant), the session lookup,
 * the rate limiter and Next request plumbing are stubbed. This is what proves
 * `searchSoftwareFleetWide` resolves its tenant under `runWithApiKeyUser`.
 *
 * Run (see integration-testing skill for the cloned-DB recipe):
 *   cd server && REQUIRE_DB=1 TEST_DB_NAME=<clone> DB_HOST=127.0.0.1 DB_PORT=5474 \
 *     DB_USER_ADMIN=<role> DB_PASSWORD_ADMIN=<pw> \
 *     npx vitest run --config vitest.workspace-db.config.ts src/test/unit/api/softwareSearchApiKey.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { insertTestAssets } from '../../../../../shared/test-utils/assetFixtures';
import { createTestApiKey } from '../../e2e/utils/apiTestHelpers';
import { createTestUserWithPermissions } from '../../e2e/utils/e2eTestSetup';

const connection = vi.hoisted(() => ({ db: undefined as Knex | undefined }));
const sessionState = vi.hoisted(() => ({ session: null as unknown }));

vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  getConnection: async () => connection.db!,
  // No ambient tenant: a caller that relies on it gets tenant=null and throws.
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? null }),
  // The session path loads the caller on its own pooled connection, which cannot see the
  // uncommitted test transaction; resolve the same user (with roles) through it instead.
  getUserWithRoles: async (userId: string, tenantId: string) =>
    (await import('../../../../../packages/users/src/actions/user-actions/findUserByIdForApi'))
      .findUserByIdForApi(userId, tenantId),
}));
vi.mock('@alga-psa/auth', async (original) => {
  const actual = await original<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    // Null unless a test simulates a browser session; never reached on the API-key path.
    getSession: async () => sessionState.session,
  };
});
// `withAuth` resolves the browser caller via getCurrentUser's relative import of getSession.
vi.mock('../../../../../packages/auth/src/lib/getSession', async (original) => ({
  ...await original<typeof import('../../../../../packages/auth/src/lib/getSession')>(),
  getSession: async () => sessionState.session,
  getSessionWithRevocationCheck: async () => sessionState.session,
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

const route = await import('../../../app/api/v1/software/search/route');

let db: Knex;
let tenant: string;
let readerId: string;
let readerKey: string;
let noReadKey: string;

beforeAll(async () => {
  process.env.APP_ENV ||= 'test';
  db = await createTestDbConnection();
  tenant = (await db('tenants').first<{ tenant: string }>('tenant'))!.tenant;
}, 180_000);

beforeEach(async () => {
  sessionState.session = null;
  const trx = await db.transaction();
  connection.db = trx;

  const clientId = randomUUID();
  await trx('clients').insert({ tenant, client_id: clientId, client_name: `Client ${clientId}` });
  const assetId = randomUUID();
  await insertTestAssets(trx, {
    tenant, asset_id: assetId, client_id: clientId, asset_type: 'workstation',
    asset_tag: `tag-${assetId}`, name: 'Search target', status: 'active',
  });
  const softwareId = randomUUID();
  await trx('software_catalog').insert({
    tenant, software_id: softwareId, name: 'Google Chrome', publisher: 'Google', normalized_name: 'google chrome',
    category: 'Browser', software_type: 'application',
  });
  await trx('asset_software').insert({ tenant, asset_id: assetId, software_id: softwareId, version: '1.0' });

  readerId = await createTestUserWithPermissions(trx, tenant, ['asset:read']);
  readerKey = (await createTestApiKey(trx, readerId, tenant)).api_key;
  const noReadId = await createTestUserWithPermissions(trx, tenant, []);
  noReadKey = (await createTestApiKey(trx, noReadId, tenant)).api_key;
});
afterEach(async () => { await (connection.db as Knex.Transaction)?.rollback(); });
afterAll(async () => { await db?.destroy().catch(() => undefined); });

async function call(query = '', headers: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost/api/v1/software/search${query}`, { headers });
  const response = await route.GET(request);
  return { status: response.status, body: await response.json() };
}
const withKey = (apiKey: string) => ({ 'x-api-key': apiKey, 'x-tenant-id': tenant });

describe('GET /api/v1/software/search with x-api-key', () => {
  it('200s with paginated results for a key holding asset:read', async () => {
    const { status, body } = await call('', withKey(readerKey));
    expect(status).toBe(200);
    expect(body.pagination).toEqual({ page: 1, limit: 50, total: expect.any(Number), totalPages: expect.any(Number) });
    expect(body.pagination.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body._links).toEqual({
      self: { href: '/api/v1/software/search' },
      assets: { href: '/api/v1/assets' },
    });
  });

  it('honours search, page and limit', async () => {
    const { status, body } = await call('?search=chrome&page=1&limit=10', withKey(readerKey));
    expect(status).toBe(200);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(10);
    expect(body.data.some((r: { name: string }) => /chrome/i.test(r.name))).toBe(true);
  });

  it('401s (not 500) with neither a key nor a session', async () => {
    const { status } = await call('', { 'x-tenant-id': tenant });
    expect(status).toBe(401);
  });

  it('401s for an invalid key', async () => {
    const { status } = await call('', withKey('not-a-real-key'));
    expect(status).toBe(401);
  });

  it('403s a key whose user lacks asset:read', async () => {
    const { status } = await call('', withKey(noReadKey));
    expect(status).toBe(403);
  });

  it.each([
    ['page=0'],
    ['limit=abc'],
    ['limit=101'],
    ['category=NotACategory'],
  ])('400s for bad params (%s)', async (query) => {
    const { status } = await call(`?${query}`, withKey(readerKey));
    expect(status).toBe(400);
  });
});

describe('GET /api/v1/software/search with a session and no x-api-key', () => {
  it('still 200s', async () => {
    sessionState.session = {
      user: { id: readerId, tenant, user_type: 'internal' },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const { status, body } = await call('?search=chrome');
    expect(status).toBe(200);
    expect(body.pagination.page).toBe(1);
  });
});
