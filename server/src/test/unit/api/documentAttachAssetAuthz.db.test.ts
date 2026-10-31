/**
 * POST /api/v1/documents -> asset attach must run the same record-level read
 * authorization as the asset routes (alga-2026-0002947). A denied asset answers
 * exactly like a missing one (404 "Asset not found"), before the source is
 * resolved or anything is uploaded.
 *
 * Real route/controller, adapter, AssetService, API-key auth and RBAC run on a
 * migrated DB. The authorization kernel decision is stubbed (deny a chosen asset
 * id) because a record-level denial needs bundle/rule fixtures; resolveSource and
 * attachDocumentFromBytes are spies so we can prove they are never reached.
 *
 * Run (see integration-testing skill for the cloned-DB recipe):
 *   cd server && REQUIRE_DB=1 TEST_DB_NAME=<clone> DB_HOST=127.0.0.1 DB_PORT=5474 \
 *     DB_USER_ADMIN=<role> DB_PASSWORD_ADMIN=<pw> \
 *     npx vitest run --config vitest.workspace-db.config.ts src/test/unit/api/documentAttachAssetAuthz.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestApiKey } from '../../e2e/utils/apiTestHelpers';
import { createTestUserWithPermissions } from '../../e2e/utils/e2eTestSetup';

const connection = vi.hoisted(() => ({ db: undefined as Knex | undefined }));
const spies = vi.hoisted(() => ({
  deniedAssetId: undefined as string | undefined,
  kernel: vi.fn(),
  resolveSource: vi.fn(),
  attach: vi.fn(),
}));

vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  getConnection: async () => connection.db!,
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? null }),
}));
vi.mock('@alga-psa/auth', async (original) => ({
  ...await original<typeof import('@alga-psa/auth')>(),
  getSession: async () => null,
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
vi.mock('../../../lib/api/controllers/authorizationKernel', async (original) => ({
  ...await original<typeof import('../../../lib/api/controllers/authorizationKernel')>(),
  authorizeApiResourceRead: async (input: { recordContext: { id?: string } }) => {
    spies.kernel(input);
    return input.recordContext?.id !== spies.deniedAssetId;
  },
}));
vi.mock('../../../lib/api/services/documents/resolveSource', () => ({
  resolveSource: (...args: unknown[]) => spies.resolveSource(...args),
}));
vi.mock('../../../lib/api/services/documents/attachDocument', () => ({
  attachDocumentFromBytes: (...args: unknown[]) => spies.attach(...args),
}));

const route = await import('../../../app/api/v1/documents/route');

let db: Knex;
let tenant: string;
let assetId: string;
let deniedAssetId: string;
let fullKey: string;
let noUpdateKey: string;

async function insertAsset(trx: Knex, clientId: string): Promise<string> {
  const id = randomUUID();
  await trx('assets').insert({
    tenant, asset_id: id, client_id: clientId, asset_type: 'workstation',
    asset_tag: `tag-${id}`, name: 'Attach target', status: 'active',
  });
  return id;
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
  assetId = await insertAsset(trx, clientId);
  deniedAssetId = await insertAsset(trx, clientId);
  spies.deniedAssetId = deniedAssetId;

  const fullId = await createTestUserWithPermissions(trx, tenant, ['document:create', 'asset:update', 'asset:read']);
  fullKey = (await createTestApiKey(trx, fullId, tenant)).api_key;
  const noUpdateId = await createTestUserWithPermissions(trx, tenant, ['document:create', 'asset:read']);
  noUpdateKey = (await createTestApiKey(trx, noUpdateId, tenant)).api_key;

  spies.kernel.mockClear();
  spies.resolveSource.mockReset().mockResolvedValue({ buffer: Buffer.from('x'), fileName: 'a.txt', mimeType: 'text/plain' });
  spies.attach.mockReset().mockResolvedValue({ document_id: randomUUID(), document_name: 'a.txt' });
});
afterEach(async () => { await (connection.db as Knex.Transaction)?.rollback(); });
afterAll(async () => { await db?.destroy().catch(() => undefined); });

async function post(entityId: string, apiKey: string) {
  const request = new NextRequest('http://localhost/api/v1/documents', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'x-tenant-id': tenant, 'content-type': 'application/json' },
    body: JSON.stringify({
      entity_type: 'asset', entity_id: entityId,
      source: { type: 'base64', content: Buffer.from('hello').toString('base64') },
      file_name: 'a.txt', mime_type: 'text/plain',
    }),
  });
  const response = await route.POST(request);
  return { status: response.status, body: await response.json() };
}
const stable = (b: any) => JSON.stringify({ ...b, meta: { ...b.meta, timestamp: undefined, requestId: undefined } });

describe('POST /api/v1/documents entity_type=asset', () => {
  it('404s Asset not found for an asset the caller cannot read, before resolving or uploading', async () => {
    const { status, body } = await post(deniedAssetId, fullKey);
    expect(status).toBe(404);
    expect(body.error).toMatchObject({ message: 'Asset not found', code: 'NOT_FOUND' });
    expect(spies.resolveSource).not.toHaveBeenCalled();
    expect(spies.attach).not.toHaveBeenCalled();
  });

  it('201s for an accessible asset', async () => {
    const { status } = await post(assetId, fullKey);
    expect(status).toBe(201);
    expect(spies.attach).toHaveBeenCalledTimes(1);
  });

  it('answers a nonexistent asset with a 404 identical to the denied case', async () => {
    const missing = await post(randomUUID(), fullKey);
    const denied = await post(deniedAssetId, fullKey);
    expect(missing.status).toBe(404);
    expect(denied.status).toBe(404);
    expect(stable(denied.body)).toBe(stable(missing.body));
  });

  it('403s without asset:update and never loads the asset or calls the kernel', async () => {
    for (const id of [assetId, deniedAssetId, randomUUID()]) {
      const { status, body } = await post(id, noUpdateKey);
      expect(status).toBe(403);
      expect(JSON.stringify(body)).not.toContain('Asset not found');
    }
    expect(spies.kernel).not.toHaveBeenCalled();
    expect(spies.resolveSource).not.toHaveBeenCalled();
  });
});
