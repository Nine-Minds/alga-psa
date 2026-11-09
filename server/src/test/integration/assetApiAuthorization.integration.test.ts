import { insertTestAssets } from '../../../../shared/test-utils/assetFixtures';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTestApiKey } from '../e2e/utils/apiTestHelpers';
import { createAuthorizationBundle, createBundleAssignment, publishBundleRevision, upsertBundleRule } from '@alga-psa/authorization/bundles/service';

const connection = vi.hoisted(() => ({ db: undefined as Knex | undefined, tenant: '' }));

// The route, API-key validator, RBAC, authorization kernel, and AssetService
// remain real. Only the connection factories point at the disposable DB txn.
vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  getConnection: async () => connection.db!,
  getAdminConnection: async () => connection.db!,
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? connection.tenant }),
}));
vi.mock('@alga-psa/db/admin', async (original) => ({
  ...await original<typeof import('@alga-psa/db/admin')>(),
  getAdminConnection: async () => connection.db!,
}));
vi.mock('@/lib/db/db', async (original) => ({
  ...await original<typeof import('@/lib/db/db')>(),
  getConnection: async () => connection.db!,
}));
vi.mock('../../../../packages/db/src/lib/tenant', async (original) => ({
  ...await original<typeof import('../../../../packages/db/src/lib/tenant')>(),
  createTenantKnex: async () => ({ knex: connection.db!, tenant: connection.tenant }),
}));
vi.mock('@alga-psa/auth', async () => {
  const { ApiKeyService, shouldTouchApiKeyLastUsed } = await import('../../../../packages/auth/src/services/apiKeyService');
  const actual = await vi.importActual<typeof import('@alga-psa/auth')>('@alga-psa/auth');
  return { ...actual, ApiKeyService, shouldTouchApiKeyLastUsed };
});
vi.mock('@/lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

let db: Knex;
let tenant: string;
const cleanupTenants = new Set<string>();
let assetGet: typeof import('../../app/api/v1/assets/route').GET;
let assetPost: typeof import('../../app/api/v1/assets/route').POST;
let assetItemGet: typeof import('../../app/api/v1/assets/[id]/route').GET;
let assetItemPut: typeof import('../../app/api/v1/assets/[id]/route').PUT;
let assetItemDelete: typeof import('../../app/api/v1/assets/[id]/route').DELETE;
let relationshipDelete: typeof import('../../app/api/v1/assets/relationships/[relationshipId]/route').DELETE;
let documentAssociationDelete: typeof import('../../app/api/v1/assets/documents/[associationId]/route').DELETE;
let exportGet: typeof import('../../app/api/v1/assets/export/route').GET;
let searchGet: typeof import('../../app/api/v1/assets/search/route').GET;
let statsGet: typeof import('../../app/api/v1/assets/stats/route').GET;
let bulkUpdate: typeof import('../../app/api/v1/assets/bulk-update/route').PUT;

const table = (name: string) => tenantDb(connection.db!, tenant).table(name);
const schema = (name: string) => tenantDb(db, '__asset_authz_schema__').unscoped(name, 'asset authz integration schema inspection');

async function createCaller(actions: string[]) {
  const userId = randomUUID();
  await table('users').insert({
    tenant, user_id: userId, username: `asset-authz-${userId}`, email: `${userId}@example.test`,
    first_name: 'Asset', last_name: 'Caller', hashed_password: 'not-used', user_type: 'internal', is_inactive: false,
  });
  if (actions.length) {
    const roleId = randomUUID();
    await table('roles').insert({ tenant, role_id: roleId, role_name: `Asset Authz ${roleId}`, msp: true, client: false });
    await table('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    for (const action of actions) {
      let permission = await table('permissions').where({ resource: 'asset', action }).first('permission_id');
      if (!permission) {
        const permissionId = randomUUID();
        [permission] = await table('permissions').insert({ tenant, permission_id: permissionId, resource: 'asset', action, msp: true, client: false }).returning('permission_id');
      }
      await table('role_permissions').insert({ tenant, role_id: roleId, permission_id: permission.permission_id }).onConflict(['tenant', 'role_id', 'permission_id']).ignore();
    }
  }
  const key = await createTestApiKey(connection.db!, userId, tenant, `asset-authz-${userId}`);
  return { userId, apiKey: key.api_key, apiKeyId: key.api_key_id };
}

async function grantBundle(caller: { userId: string; apiKeyId: string }, clientIds: string[], actions = ['read']) {
  const bundle = await createAuthorizationBundle(connection.db!, { tenant, name: `Asset scope ${randomUUID()}`, actorUserId: caller.userId });
  for (const action of actions) {
    await upsertBundleRule(connection.db!, {
      tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
      resourceType: 'asset', action, templateKey: 'selected_clients',
      config: { selectedClientIds: clientIds }, actorUserId: caller.userId,
    });
  }
  await publishBundleRevision(connection.db! as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: caller.userId });
  await createBundleAssignment(connection.db!, {
    tenant, bundleId: bundle.bundleId, targetType: 'api_key', targetId: caller.apiKeyId, actorUserId: caller.userId,
  });
}

function request(caller: { apiKey: string }, path: string, method = 'GET', body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'x-api-key': caller.apiKey, 'x-tenant-id': tenant, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function invoke(handler: Function, req: NextRequest, params?: Record<string, string>) {
  return handler(req, { params: Promise.resolve(params ?? {}) });
}

async function createAsset(clientId: string, name: string) {
  const assetId = randomUUID();
  await insertTestAssets(connection.db!, { tenant, asset_id: assetId, asset_tag: `TAG-${assetId}`, serial_number: `SER-${assetId}`, name, status: 'active', asset_type: 'workstation', client_id: clientId, created_at: db.fn.now(), updated_at: db.fn.now() });
  return assetId;
}

beforeAll(async () => {
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
  process.env.DB_HOST = process.env.DB_HOST || 'localhost';
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
  process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
  db = await createTestDbConnection({ runSeeds: false });
  ({ GET: assetGet, POST: assetPost } = await import('../../app/api/v1/assets/route'));
  ({ GET: assetItemGet, PUT: assetItemPut, DELETE: assetItemDelete } = await import('../../app/api/v1/assets/[id]/route'));
  ({ DELETE: relationshipDelete } = await import('../../app/api/v1/assets/relationships/[relationshipId]/route'));
  ({ DELETE: documentAssociationDelete } = await import('../../app/api/v1/assets/documents/[associationId]/route'));
  ({ GET: exportGet } = await import('../../app/api/v1/assets/export/route'));
  ({ GET: searchGet } = await import('../../app/api/v1/assets/search/route'));
  ({ GET: statsGet } = await import('../../app/api/v1/assets/stats/route'));
  ({ PUT: bulkUpdate } = await import('../../app/api/v1/assets/bulk-update/route'));
}, 180_000);

beforeEach(async () => {
  tenant = randomUUID();
  connection.tenant = tenant;
  cleanupTenants.add(tenant);
  const tenantRow = { tenant, company_name: 'Asset authz integration', email: `${tenant}@example.test`, product_code: 'psa', created_at: db.fn.now(), updated_at: db.fn.now() };
  const cols = await schema('tenants').columnInfo();
  if (!('company_name' in cols)) { delete (tenantRow as any).company_name; (tenantRow as any).client_name = 'Asset authz integration'; }
  if (!('product_code' in cols)) delete (tenantRow as any).product_code;
  await tenantDb(db, '__asset_authz_fixture__').unscoped('tenants', 'create API authz tenant').insert(tenantRow);
  connection.db = await db.transaction();
});

afterEach(async () => { await (connection.db as Knex.Transaction)?.rollback(); });
afterAll(async () => {
  for (const id of cleanupTenants) await tenantDb(db, id).unscoped('tenants', 'remove asset authz fixture tenant').where({ tenant: id }).del().catch(() => undefined);
  await db?.destroy();
});

describe('asset API-key authorization through public routes and migrated PostgreSQL schema', () => {
  async function clients() {
    const a = randomUUID(); const b = randomUUID();
    await table('clients').insert([
      { tenant, client_id: a, client_name: `Allowed ${a}` },
      { tenant, client_id: b, client_name: `Denied ${b}` },
    ]);
    return { a, b };
  }

  it('enforces distinct reader, creator, updater, and deleter permissions at authenticated route boundaries', async () => {
    const { a } = await clients();
    const assetId = await createAsset(a, 'Existing asset');
    const noAsset = await createCaller([]);
    expect((await invoke(assetGet, request(noAsset, '/api/v1/assets'))).status).toBe(403);
    expect((await invoke(assetPost, request(noAsset, '/api/v1/assets', 'POST', { name: 'No', asset_tag: 'NO', asset_type: 'workstation', client_id: a }), {})).status).toBe(403);
    expect((await invoke(assetItemGet, request(noAsset, `/api/v1/assets/${assetId}`), { id: assetId })).status).toBe(403);
    expect((await invoke(assetItemPut, request(noAsset, `/api/v1/assets/${assetId}`, 'PUT', { name: 'No' }), { id: assetId })).status).toBe(403);
    expect((await invoke(assetItemDelete, request(noAsset, `/api/v1/assets/${assetId}`, 'DELETE'), { id: assetId })).status).toBe(403);

    const reader = await createCaller(['read']);
    const itemResponse = await invoke(assetItemGet, request(reader, `/api/v1/assets/${assetId}`), { id: assetId });
    expect(itemResponse.status, JSON.stringify(await itemResponse.clone().json())).toBe(200);
    expect((await invoke(assetItemPut, request(reader, `/api/v1/assets/${assetId}`, 'PUT', { name: 'Denied' }), { id: assetId })).status).toBe(403);
    expect((await invoke(assetItemDelete, request(reader, `/api/v1/assets/${assetId}`, 'DELETE'), { id: assetId })).status).toBe(403);
    expect((await invoke(assetPost, request(reader, '/api/v1/assets', 'POST', { name: 'No create', asset_tag: `NO-${randomUUID()}`, asset_type: 'workstation', client_id: a, status: 'active' }))).status).toBe(403);

    const creator = await createCaller(['create']);
    const created = await invoke(assetPost, request(creator, '/api/v1/assets', 'POST', { name: 'Created', asset_tag: `NEW-${randomUUID()}`, asset_type: 'workstation', client_id: a, status: 'active' }));
    expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
    const createdAssetId = (await created.json()).data.asset_id;
    expect((await invoke(assetItemGet, request(creator, `/api/v1/assets/${createdAssetId}`), { id: createdAssetId })).status).toBe(403);
    expect((await invoke(assetItemPut, request(creator, `/api/v1/assets/${createdAssetId}`, 'PUT', { name: 'No update' }), { id: createdAssetId })).status).toBe(403);

    const updater = await createCaller(['update']);
    expect((await invoke(assetItemGet, request(updater, `/api/v1/assets/${assetId}`), { id: assetId })).status).toBe(403);
    const updated = await invoke(assetItemPut, request(updater, `/api/v1/assets/${assetId}`, 'PUT', { name: 'Updated' }), { id: assetId });
    expect(updated.status).toBe(200);
    expect((await invoke(assetItemDelete, request(updater, `/api/v1/assets/${assetId}`, 'DELETE'), { id: assetId })).status).toBe(403);
    const deleter = await createCaller(['delete']);
    expect((await invoke(assetItemPut, request(deleter, `/api/v1/assets/${createdAssetId}`, 'PUT', { name: 'No update' }), { id: createdAssetId })).status).toBe(403);
    expect((await invoke(assetItemDelete, request(deleter, `/api/v1/assets/${assetId}`, 'DELETE'), { id: assetId })).status).toBe(204);
  }, 180_000);

  it('applies key-specific bundle scope inside list, count, export, and statistics queries', async () => {
    const { a, b } = await clients();
    const allowedId = await createAsset(a, 'Allowed asset');
    const deniedId = await createAsset(b, 'Denied asset');
    const caller = await createCaller(['read']);
    await grantBundle(caller, [a]);
    const previousKernel = globalThis.__algaAuthorizationKernelSingleton;
    const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
    globalThis.__algaAuthorizationKernelSingleton = await createEnterpriseAuthorizationKernel();
    try {
      const listed = await invoke(assetGet, request(caller, '/api/v1/assets?limit=50'));
      const listBody = await listed.json();
      expect(listBody.data.map((row: any) => row.asset_id)).toContain(allowedId);
      expect(listBody.data.map((row: any) => row.asset_id)).not.toContain(deniedId);
      expect(listBody.pagination.total).toBe(1);
      const searched = await invoke(searchGet, request(caller, '/api/v1/assets/search?query=asset'));
      const searchPayload = JSON.stringify(await searched.json());
      expect(searchPayload).toContain(allowedId);
      expect(searchPayload).not.toContain(deniedId);
      const exported = await invoke(exportGet, request(caller, '/api/v1/assets/export?format=json'));
      const exportBody = JSON.stringify(await exported.json());
      expect(exportBody).toContain(allowedId);
      expect(exportBody).not.toContain(deniedId);
      const stats = await invoke(statsGet, request(caller, '/api/v1/assets/stats'));
      expect((await stats.json()).data.total_assets).toBe(1);
    } finally { globalThis.__algaAuthorizationKernelSingleton = previousKernel; }
  }, 180_000);

  it('uses the schema composite relationship identity, filters denied relationship rows, and authorizes delete as target-update plus related-read', async () => {
    const { a, b } = await clients();
    const parentId = await createAsset(a, 'Parent');
    const childId = await createAsset(b, 'Denied child');
    const caller = await createCaller(['read', 'update']);
    await grantBundle(caller, [a], ['read']);
    await table('asset_relationships').insert({ tenant, parent_asset_id: parentId, child_asset_id: childId, relationship_type: 'connected_to' });
    const previousKernel = globalThis.__algaAuthorizationKernelSingleton;
    const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
    globalThis.__algaAuthorizationKernelSingleton = await createEnterpriseAuthorizationKernel();
    try {
      const details = await invoke(assetItemGet, request(caller, `/api/v1/assets/${parentId}`), { id: parentId });
      const payload = await details.json();
      expect(payload.data.relationships).toEqual([]);
      expect(JSON.stringify(payload)).not.toContain(childId);
      const absent = await invoke(relationshipDelete, request(caller, `/api/v1/assets/relationships/${parentId}:${childId}`, 'DELETE'), { relationshipId: `${parentId}:${childId}` });
      expect(absent.status).toBe(404);
      expect(await table('asset_relationships').where({ tenant, parent_asset_id: parentId, child_asset_id: childId })).toHaveLength(1);
      const otherChildId = randomUUID();
      const unauthorizedPair = await invoke(relationshipDelete, request(caller, `/api/v1/assets/relationships/${parentId}:${otherChildId}`, 'DELETE'), { relationshipId: `${parentId}:${otherChildId}` });
      expect(unauthorizedPair.status).toBe(404);
      const associationId = randomUUID();
      const missingDocumentAssociation = await invoke(documentAssociationDelete, request(caller, `/api/v1/assets/documents/${associationId}`, 'DELETE'), { associationId });
      expect(missingDocumentAssociation.status).toBe(404);
    } finally { globalThis.__algaAuthorizationKernelSingleton = previousKernel; }
  }, 180_000);

  it('persists authorized relationship create/delete on the migrated composite-key table and returns 404 for a missing tenant-scoped pair', async () => {
    const { a } = await clients();
    const parentId = await createAsset(a, 'Relationship parent');
    const childId = await createAsset(a, 'Relationship child');
    const caller = await createCaller(['read', 'update']);
    const previousKernel = globalThis.__algaAuthorizationKernelSingleton;
    const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
    globalThis.__algaAuthorizationKernelSingleton = await createEnterpriseAuthorizationKernel();
    try {
      const { POST: relationshipPost } = await import('../../app/api/v1/assets/[id]/relationships/route');
      const created = await invoke(relationshipPost, request(caller, `/api/v1/assets/${parentId}/relationships`, 'POST', { related_asset_id: childId, relationship_type: 'connected_to' }), { id: parentId });
      expect(created.status).toBe(201);
      const createdBody = await created.json();
      expect(createdBody.data.parent_asset_id).toBe(parentId);
      expect(createdBody.data.child_asset_id).toBe(childId);
      expect(createdBody.data.asset_id).toBe(parentId);
      expect(createdBody.data.related_asset_id).toBe(childId);
      expect(await table('asset_relationships').where({ tenant, parent_asset_id: parentId, child_asset_id: childId })).toHaveLength(1);
      const identity = `${parentId}:${childId}`;
      const deleted = await invoke(relationshipDelete, request(caller, `/api/v1/assets/relationships/${identity}`, 'DELETE'), { relationshipId: identity });
      expect(deleted.status).toBe(204);
      expect(await table('asset_relationships').where({ tenant, parent_asset_id: parentId, child_asset_id: childId })).toHaveLength(0);
      const missId = randomUUID();
      const missing = await invoke(relationshipDelete, request(caller, `/api/v1/assets/relationships/${missId}:${childId}`, 'DELETE'), { relationshipId: `${missId}:${childId}` });
      expect(missing.status).toBe(404);

      // The same composite identity exists under another tenant. It must be a
      // tenant-scoped miss to this API key, with the foreign row untouched.
      const foreignTenant = randomUUID();
      const foreignClient = randomUUID();
      const foreignParent = randomUUID();
      const foreignChild = randomUUID();
      const tenantColumns = await schema('tenants').columnInfo();
      const foreignTenantRow: Record<string, unknown> = {
        tenant: foreignTenant,
        email: `${foreignTenant}@example.test`,
        ...(tenantColumns.company_name ? { company_name: 'Foreign asset scope' } : { client_name: 'Foreign asset scope' }),
        ...(tenantColumns.product_code ? { product_code: 'psa' } : {}),
      };
      await tenantDb(db, '__asset_authz_foreign__').unscoped('tenants', 'create foreign asset authorization fixture').insert(foreignTenantRow);
      try {
        await tenantDb(db, foreignTenant).table('clients').insert({ tenant: foreignTenant, client_id: foreignClient, client_name: 'Foreign client' });
        const foreignAsset = (assetId: string, name: string) => ({
          tenant: foreignTenant, asset_id: assetId, asset_tag: `FOREIGN-${assetId}`, serial_number: `FOREIGN-${assetId}`,
          name, status: 'active', asset_type: 'workstation', client_id: foreignClient,
        });
        await insertTestAssets(db, [
          foreignAsset(foreignParent, 'Foreign parent'), foreignAsset(foreignChild, 'Foreign child'),
        ]);
        await tenantDb(db, foreignTenant).table('asset_relationships').insert({
          tenant: foreignTenant, parent_asset_id: foreignParent, child_asset_id: foreignChild, relationship_type: 'foreign',
        });
        const foreignMiss = await invoke(relationshipDelete, request(caller, `/api/v1/assets/relationships/${foreignParent}:${foreignChild}`, 'DELETE'), { relationshipId: `${foreignParent}:${foreignChild}` });
        expect(foreignMiss.status).toBe(404);
        expect(await tenantDb(db, foreignTenant).table('asset_relationships').where({ parent_asset_id: foreignParent, child_asset_id: foreignChild })).toHaveLength(1);
      } finally {
        await tenantDb(db, foreignTenant).table('asset_relationships').where({ parent_asset_id: foreignParent }).del().catch(() => undefined);
        await tenantDb(db, foreignTenant).table('assets').whereIn('asset_id', [foreignParent, foreignChild]).del().catch(() => undefined);
        await tenantDb(db, foreignTenant).table('clients').where({ client_id: foreignClient }).del().catch(() => undefined);
        await tenantDb(db, '__asset_authz_foreign__').unscoped('tenants', 'remove foreign asset authorization fixture').where({ tenant: foreignTenant }).del().catch(() => undefined);
      }
    } finally { globalThis.__algaAuthorizationKernelSingleton = previousKernel; }
  }, 180_000);

  it('rejects target-client moves and mixed-scope bulk updates without partial writes', async () => {
    const { a, b } = await clients();
    const firstId = await createAsset(a, 'First');
    const secondId = await createAsset(b, 'Second');
    const caller = await createCaller(['update']);
    await grantBundle(caller, [a], ['update']);
    const previousKernel = globalThis.__algaAuthorizationKernelSingleton;
    const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
    globalThis.__algaAuthorizationKernelSingleton = await createEnterpriseAuthorizationKernel();
    try {
      const inScopeUpdate = await invoke(assetItemPut, request(caller, `/api/v1/assets/${firstId}`, 'PUT', { name: 'In scope update' }), { id: firstId });
      expect(inScopeUpdate.status, JSON.stringify(await inScopeUpdate.clone().json())).toBe(200);
      await table('assets').where({ tenant, asset_id: firstId }).update({ name: 'First' });
      const move = await invoke(assetItemPut, request(caller, `/api/v1/assets/${firstId}`, 'PUT', { client_id: b }), { id: firstId });
      expect(move.status).toBe(404);
      expect((await table('assets').where({ tenant, asset_id: firstId }).first()).client_id).toBe(a);
      const deniedBulk = await invoke(bulkUpdate, request(caller, '/api/v1/assets/bulk-update', 'PUT', { assets: [firstId, secondId].map((asset_id) => ({ asset_id, data: { name: 'Bulk changed' } })) }));
      expect(deniedBulk.status).toBe(404);
      const unchanged = await table('assets').where({ tenant }).whereIn('asset_id', [firstId, secondId]).select('name');
      expect(unchanged.map((row: any) => row.name).sort()).toEqual(['First', 'Second']);
    } finally { globalThis.__algaAuthorizationKernelSingleton = previousKernel; }
  }, 180_000);
});
