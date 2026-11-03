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
let assetDocumentsGet: typeof import('../../app/api/v1/assets/[id]/documents/route').GET;
let assetDocumentsPost: typeof import('../../app/api/v1/assets/[id]/documents/route').POST;
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

async function grantPermission(caller: { userId: string }, resource: string, action: string) {
  const assignment = await table('user_roles').where({ user_id: caller.userId }).first('role_id');
  if (!assignment) throw new Error('Caller role is required to grant an integration-test permission');
  let permission = await table('permissions').where({ resource, action }).first('permission_id');
  if (!permission) {
    const permissionId = randomUUID();
    [permission] = await table('permissions')
      .insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false })
      .returning('permission_id');
  }
  await table('role_permissions')
    .insert({ tenant, role_id: assignment.role_id, permission_id: permission.permission_id })
    .onConflict(['tenant', 'role_id', 'permission_id'])
    .ignore();
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
  await table('assets').insert({ tenant, asset_id: assetId, asset_tag: `TAG-${assetId}`, serial_number: `SER-${assetId}`, name, status: 'active', asset_type: 'workstation', client_id: clientId, created_at: db.fn.now(), updated_at: db.fn.now() });
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
  ({ GET: assetDocumentsGet, POST: assetDocumentsPost } = await import('../../app/api/v1/assets/[id]/documents/route'));
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

  it('requires ticket:update for ticket links even when the API key can read tickets', async () => {
    const { a } = await clients();
    const assetId = await createAsset(a, 'Ticket authorization target');
    const caller = await createCaller(['update']);
    await grantPermission(caller, 'ticket', 'read');

    const ticketId = randomUUID();
    const linked = await invoke(
      (await import('../../app/api/v1/assets/[id]/tickets/route')).POST,
      request(caller, `/api/v1/assets/${assetId}/tickets`, 'POST', { ticket_id: ticketId }),
      { id: assetId },
    );
    expect(linked.status).toBe(403);
    expect(await table('asset_associations').where({ asset_id: assetId, entity_id: ticketId, entity_type: 'ticket' })).toHaveLength(0);

    await table('asset_associations').insert({
      tenant, asset_id: assetId, entity_id: ticketId, entity_type: 'ticket',
      relationship_type: 'affected', created_by: caller.userId,
    });
    const unlinked = await invoke(
      (await import('../../app/api/v1/assets/[id]/tickets/[ticketId]/route')).DELETE,
      request(caller, `/api/v1/assets/${assetId}/tickets/${ticketId}`, 'DELETE'),
      { id: assetId, ticketId },
    );
    expect(unlinked.status).toBe(403);
    expect(await table('asset_associations').where({ asset_id: assetId, entity_id: ticketId, entity_type: 'ticket' })).toHaveLength(1);
  }, 180_000);

  it('requires ticket:read for assignment and status routes, as specified by the asset API permission map', async () => {
    const { a } = await clients();
    const assetId = await createAsset(a, 'Ticket-read gated asset routes');
    const caller = await createCaller(['read']);
    const [{ GET: assignmentsGet }, { GET: statusesGet }] = await Promise.all([
      import('../../app/api/v1/assets/[id]/assignments/route'),
      import('../../app/api/v1/asset-statuses/route'),
    ]);

    expect((await invoke(assignmentsGet, request(caller, `/api/v1/assets/${assetId}/assignments`), { id: assetId })).status).toBe(403);
    expect((await invoke(statusesGet, request(caller, '/api/v1/asset-statuses'))).status).toBe(403);

    await grantPermission(caller, 'ticket', 'read');
    expect((await invoke(assignmentsGet, request(caller, `/api/v1/assets/${assetId}/assignments`), { id: assetId })).status).toBe(200);
    expect((await invoke(statusesGet, request(caller, '/api/v1/asset-statuses'))).status).toBe(200);
  }, 180_000);

  it('requires coarse permissions across every public ApiAssetController action, including document and maintenance mutations', async () => {
    const caller = await createCaller([]);
    const id = randomUUID();
    const ticketId = randomUUID();
    const relationshipId = `${id}:${randomUUID()}`;
    const scheduleId = randomUUID();
    const associationId = randomUUID();
    const routeCases: Array<[string, string, Function, Record<string, string>?, number?]> = [];
    const [collection, item, relationships, assignments, tickets, docs, documentAssociation, maintenance, maintenanceRecord, maintenanceSchedule, history, relationship, assetExport, search, stats, bulkUpdateRoute, bulkStatusRoute, assetStatuses] = await Promise.all([
      import('../../app/api/v1/assets/route'),
      import('../../app/api/v1/assets/[id]/route'),
      import('../../app/api/v1/assets/[id]/relationships/route'),
      import('../../app/api/v1/assets/[id]/assignments/route'),
      import('../../app/api/v1/assets/[id]/tickets/route'),
      import('../../app/api/v1/assets/[id]/documents/route'),
      import('../../app/api/v1/assets/documents/[associationId]/route'),
      import('../../app/api/v1/assets/[id]/maintenance/route'),
      import('../../app/api/v1/assets/[id]/maintenance/record/route'),
      import('../../app/api/v1/assets/maintenance/[scheduleId]/route'),
      import('../../app/api/v1/assets/[id]/history/route'),
      import('../../app/api/v1/assets/relationships/[relationshipId]/route'),
      import('../../app/api/v1/assets/export/route'),
      import('../../app/api/v1/assets/search/route'),
      import('../../app/api/v1/assets/stats/route'),
      import('../../app/api/v1/assets/bulk-update/route'),
      import('../../app/api/v1/assets/bulk-status/route'),
      import('../../app/api/v1/asset-statuses/route'),
    ]);
    routeCases.push(
      ['GET', '/api/v1/assets', collection.GET],
      ['POST', '/api/v1/assets', collection.POST],
      ['GET', `/api/v1/assets/${id}`, item.GET, { id }],
      ['PUT', `/api/v1/assets/${id}`, item.PUT, { id }],
      ['DELETE', `/api/v1/assets/${id}`, item.DELETE, { id }],
      ['GET', `/api/v1/assets/${id}/relationships`, relationships.GET, { id }],
      ['POST', `/api/v1/assets/${id}/relationships`, relationships.POST, { id }],
      ['DELETE', `/api/v1/assets/relationships/${relationshipId}`, relationship.DELETE, { relationshipId }, 404],
      ['GET', `/api/v1/assets/${id}/assignments`, assignments.GET, { id }],
      ['GET', '/api/v1/asset-statuses', assetStatuses.GET],
      ['GET', `/api/v1/assets/${id}/tickets`, tickets.GET, { id }],
      ['POST', `/api/v1/assets/${id}/tickets`, tickets.POST, { id }],
      ['DELETE', `/api/v1/assets/${id}/tickets/${ticketId}`, (await import('../../app/api/v1/assets/[id]/tickets/[ticketId]/route')).DELETE, { id, ticketId }],
      ['GET', `/api/v1/assets/${id}/documents`, docs.GET, { id }],
      ['POST', `/api/v1/assets/${id}/documents`, docs.POST, { id }],
      ['DELETE', `/api/v1/assets/documents/${associationId}`, documentAssociation.DELETE, { associationId }, 404],
      ['GET', `/api/v1/assets/${id}/maintenance`, maintenance.GET, { id }],
      ['POST', `/api/v1/assets/${id}/maintenance`, maintenance.POST, { id }],
      ['PUT', `/api/v1/assets/maintenance/${scheduleId}`, maintenanceSchedule.PUT, { scheduleId }],
      ['DELETE', `/api/v1/assets/maintenance/${scheduleId}`, maintenanceSchedule.DELETE, { scheduleId }],
      ['POST', `/api/v1/assets/${id}/maintenance/record`, maintenanceRecord.POST, { id }],
      ['GET', `/api/v1/assets/${id}/history`, history.GET, { id }],
      ['GET', '/api/v1/assets/search?query=probe', search.GET],
      ['GET', '/api/v1/assets/export?format=json', assetExport.GET],
      ['GET', '/api/v1/assets/stats', stats.GET],
      ['PUT', '/api/v1/assets/bulk-update', bulkUpdateRoute.PUT],
      ['PUT', '/api/v1/assets/bulk-status', bulkStatusRoute.PUT],
    );

    for (const [method, path, handler, params, expectedStatus = 403] of routeCases) {
      const response = await invoke(handler, request(caller, path, method, method === 'GET' || method === 'DELETE' ? undefined : {}), params);
      expect(response.status, `${method} ${path} should hide missing association IDs before checking permissions`).toBe(expectedStatus);
    }
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
        await tenantDb(db, foreignTenant).table('assets').insert([
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

  it('persists optional document-association notes through authenticated POST, GET, and DELETE routes', async () => {
    const { a } = await clients();
    const assetId = await createAsset(a, 'Document association target');
    const caller = await createCaller(['read', 'update']);
    const typeId = randomUUID();
    const documentIds = [randomUUID(), randomUUID(), randomUUID()];
    await table('document_types').insert({ tenant, type_id: typeId, type_name: `Asset docs ${typeId}`, icon: 'file' });
    await table('documents').insert(documentIds.map((documentId, index) => ({
      tenant, document_id: documentId, document_name: `Asset document ${index}`, type_id: typeId,
      user_id: caller.userId, created_by: caller.userId, entered_at: db.fn.now(), updated_at: db.fn.now(),
    })));
    const legacyAssociationId = randomUUID();
    await table('document_associations').insert({ tenant, association_id: legacyAssociationId, entity_type: 'asset', entity_id: assetId, document_id: documentIds[2] });

    const previousKernel = globalThis.__algaAuthorizationKernelSingleton;
    const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
    globalThis.__algaAuthorizationKernelSingleton = await createEnterpriseAuthorizationKernel();
    try {
      const cases = [
        { documentId: documentIds[0], body: { document_id: documentIds[0] }, expectedNotes: null },
        { documentId: documentIds[1], body: { document_id: documentIds[1], notes: 'Return to vendor before warranty expires.' }, expectedNotes: 'Return to vendor before warranty expires.' },
      ];
      for (const { documentId, body, expectedNotes } of cases) {
        const beforeGeneric = await table('document_associations').where({ tenant, entity_type: 'asset' }).select('association_id', 'entity_id', 'document_id');
        const beforeAssetSpecific = await table('asset_document_associations').where({ tenant }).select('association_id', 'asset_id', 'document_id', 'notes');
        const created = await invoke(assetDocumentsPost, request(caller, `/api/v1/assets/${assetId}/documents`, 'POST', body), { id: assetId });
        expect(created.status, JSON.stringify(await created.clone().json())).toBe(201);
        const createdBody = await created.json();
        expect(createdBody.data).toMatchObject({ asset_id: assetId, document_id: documentId, notes: expectedNotes });
        const persisted = await table('asset_document_associations').where({ tenant, asset_id: assetId, document_id: documentId }).first();
        expect(persisted).toMatchObject({ tenant, asset_id: assetId, document_id: documentId, notes: expectedNotes, created_by: caller.userId });
        expect(await table('document_associations').where({ tenant, association_id: createdBody.data.association_id, entity_id: assetId, document_id: documentId, entity_type: 'asset' })).toHaveLength(1);

        const listed = await invoke(assetDocumentsGet, request(caller, `/api/v1/assets/${assetId}/documents`), { id: assetId });
        expect(listed.status).toBe(200);
        const listedBody = await listed.json();
        const apiAssociation = listedBody.data.find((row: any) => row.association_id === createdBody.data.association_id);
        expect(apiAssociation).toMatchObject({
          association_id: createdBody.data.association_id,
          entity_type: 'asset', entity_id: assetId, asset_id: assetId, document_id: documentId,
          notes: expectedNotes,
          original_filename: `Asset document ${documentIds.indexOf(documentId)}`,
          file_size: null, mime_type: null, uploaded_at: expect.any(String),
          document: {
            document_id: documentId,
            original_filename: `Asset document ${documentIds.indexOf(documentId)}`,
            file_size: null, mime_type: null, uploaded_at: expect.any(String),
          },
        });
        const genericOnlyAssociation = listedBody.data.find((row: any) => row.association_id === legacyAssociationId);
        expect(genericOnlyAssociation).toMatchObject({
          association_id: legacyAssociationId,
          entity_type: 'asset', entity_id: assetId, asset_id: assetId, document_id: documentIds[2], notes: null,
          original_filename: 'Asset document 2', file_size: null, mime_type: null, uploaded_at: expect.any(String),
          document: {
            document_id: documentIds[2], original_filename: 'Asset document 2',
            file_size: null, mime_type: null, uploaded_at: expect.any(String),
          },
        });

        const deleted = await invoke(documentAssociationDelete, request(caller, `/api/v1/assets/documents/${createdBody.data.association_id}`, 'DELETE'), { associationId: createdBody.data.association_id });
        expect(deleted.status).toBe(204);
        expect(await table('document_associations').where({ tenant, association_id: createdBody.data.association_id })).toHaveLength(0);
        expect(await table('asset_document_associations').where({ tenant, asset_id: assetId, document_id: documentId })).toHaveLength(0);
        expect(await table('document_associations').where({ tenant, entity_type: 'asset' }).select('association_id', 'entity_id', 'document_id')).toEqual(beforeGeneric);
        expect(await table('asset_document_associations').where({ tenant }).select('association_id', 'asset_id', 'document_id', 'notes')).toEqual(beforeAssetSpecific);
      }

      // Coarse permission denial happens before insert and leaves existing
      // association rows intact, including when notes are supplied.
      const deniedCaller = await createCaller([]);
      const beforeDeniedGeneric = await table('document_associations').where({ tenant, entity_type: 'asset' }).select('association_id', 'entity_id', 'document_id');
      const beforeDeniedAssetSpecific = await table('asset_document_associations').where({ tenant }).select('association_id', 'asset_id', 'document_id', 'notes');
      const denied = await invoke(assetDocumentsPost, request(deniedCaller, `/api/v1/assets/${assetId}/documents`, 'POST', { document_id: documentIds[0], notes: 'Must not persist' }), { id: assetId });
      expect(denied.status).toBe(403);
      expect(await table('document_associations').where({ tenant, entity_type: 'asset' }).select('association_id', 'entity_id', 'document_id')).toEqual(beforeDeniedGeneric);
      expect(await table('asset_document_associations').where({ tenant }).select('association_id', 'asset_id', 'document_id', 'notes')).toEqual(beforeDeniedAssetSpecific);

      // A foreign-tenant association ID is a tenant-scoped miss and remains
      // untouched. The foreign association is constructed with the migrated
      // schema, including its tenant-bound asset/document/user references.
      const foreignTenant = randomUUID();
      const foreignClient = randomUUID();
      const foreignAsset = randomUUID();
      const foreignUser = randomUUID();
      const foreignType = randomUUID();
      const foreignDocument = randomUUID();
      const foreignAssociation = randomUUID();
      const tenantColumns = await schema('tenants').columnInfo();
      await tenantDb(connection.db!, '__asset_authz_foreign__').unscoped('tenants', 'create foreign document association tenant').insert({
        tenant: foreignTenant, email: `${foreignTenant}@example.test`,
        ...(tenantColumns.company_name ? { company_name: 'Foreign document scope' } : { client_name: 'Foreign document scope' }),
        ...(tenantColumns.product_code ? { product_code: 'psa' } : {}),
      });
      await tenantDb(connection.db!, foreignTenant).table('clients').insert({ tenant: foreignTenant, client_id: foreignClient, client_name: 'Foreign client' });
      await tenantDb(connection.db!, foreignTenant).table('users').insert({ tenant: foreignTenant, user_id: foreignUser, username: `foreign-${foreignUser}`, email: `${foreignUser}@example.test`, first_name: 'Foreign', last_name: 'User', hashed_password: 'unused', user_type: 'internal', is_inactive: false });
      await tenantDb(connection.db!, foreignTenant).table('assets').insert({ tenant: foreignTenant, asset_id: foreignAsset, client_id: foreignClient, asset_type: 'workstation', asset_tag: `foreign-${foreignAsset}`, name: 'Foreign asset', status: 'active' });
      await tenantDb(connection.db!, foreignTenant).table('document_types').insert({ tenant: foreignTenant, type_id: foreignType, type_name: `Foreign ${foreignType}`, icon: 'file' });
      await tenantDb(connection.db!, foreignTenant).table('documents').insert({ tenant: foreignTenant, document_id: foreignDocument, document_name: 'Foreign document', type_id: foreignType, user_id: foreignUser, created_by: foreignUser });
      await tenantDb(connection.db!, foreignTenant).table('asset_document_associations').insert({ tenant: foreignTenant, association_id: foreignAssociation, asset_id: foreignAsset, document_id: foreignDocument, created_by: foreignUser });
      await tenantDb(connection.db!, foreignTenant).table('document_associations').insert({ tenant: foreignTenant, association_id: foreignAssociation, entity_type: 'asset', entity_id: foreignAsset, document_id: foreignDocument });
      const foreignDelete = await invoke(documentAssociationDelete, request(caller, `/api/v1/assets/documents/${foreignAssociation}`, 'DELETE'), { associationId: foreignAssociation });
      expect(foreignDelete.status).toBe(404);
      expect(await tenantDb(connection.db!, foreignTenant).table('asset_document_associations').where({ tenant: foreignTenant, association_id: foreignAssociation })).toHaveLength(1);
    } finally { globalThis.__algaAuthorizationKernelSingleton = previousKernel; }
  }, 180_000);

  it('returns 404 for a tenant-scoped document association with a missing asset before coarse permission checks', async () => {
    const caller = await createCaller([]);
    const typeId = randomUUID();
    const documentId = randomUUID();
    const associationId = randomUUID();
    const missingAssetId = randomUUID();
    await table('document_types').insert({ tenant, type_id: typeId, type_name: `Orphan asset doc ${typeId}`, icon: 'file' });
    await table('documents').insert({
      tenant, document_id: documentId, document_name: 'Orphan asset association', type_id: typeId,
      user_id: caller.userId, created_by: caller.userId, entered_at: db.fn.now(), updated_at: db.fn.now(),
    });
    await table('document_associations').insert({
      tenant, association_id: associationId, entity_type: 'asset', entity_id: missingAssetId, document_id: documentId,
    });

    const response = await invoke(
      documentAssociationDelete,
      request(caller, `/api/v1/assets/documents/${associationId}`, 'DELETE'),
      { associationId },
    );
    expect(response.status).toBe(404);
    expect(await table('document_associations').where({ tenant, association_id: associationId })).toHaveLength(1);
  }, 180_000);

  it('rejects target-client moves and mixed-scope bulk updates without partial writes', async () => {
    const { a, b } = await clients();
    const firstId = await createAsset(a, 'First');
    const secondId = await createAsset(b, 'Second');
    const caller = await createCaller(['update']);
    await grantBundle(caller, [a], ['update']);
    const documentTypeId = randomUUID();
    const documentId = randomUUID();
    const associationId = randomUUID();
    await table('document_types').insert({ tenant, type_id: documentTypeId, type_name: `Authz ${documentTypeId}`, icon: 'file' });
    await table('documents').insert({ tenant, document_id: documentId, document_name: 'Denied association', type_id: documentTypeId, user_id: caller.userId, created_by: caller.userId, entered_at: db.fn.now(), updated_at: db.fn.now() });
    await table('asset_document_associations').insert({ tenant, association_id: associationId, document_id: documentId, asset_id: secondId, created_by: caller.userId });
    await table('document_associations').insert({ tenant, association_id: associationId, document_id: documentId, entity_id: secondId, entity_type: 'asset' });
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
      const deniedDocumentRemoval = await invoke(documentAssociationDelete, request(caller, `/api/v1/assets/documents/${associationId}`, 'DELETE'), { associationId });
      expect(deniedDocumentRemoval.status).toBe(404);
      expect(await table('asset_document_associations').where({ tenant, association_id: associationId })).toHaveLength(1);
      expect(await table('document_associations').where({ tenant, association_id: associationId })).toHaveLength(1);
      const unchanged = await table('assets').where({ tenant }).whereIn('asset_id', [firstId, secondId]).select('name');
      expect(unchanged.map((row: any) => row.name).sort()).toEqual(['First', 'Second']);
    } finally { globalThis.__algaAuthorizationKernelSingleton = previousKernel; }
  }, 180_000);

  async function grantTemplate(caller: { userId: string; apiKeyId: string }, templateKey: any, config: Record<string, unknown> = {}) {
    const bundle = await createAuthorizationBundle(connection.db!, { tenant, name: `Review ${randomUUID()}`, actorUserId: caller.userId });
    await upsertBundleRule(connection.db!, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, resourceType: 'asset', action: 'read', templateKey, config, actorUserId: caller.userId });
    await publishBundleRevision(connection.db! as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: caller.userId });
    await createBundleAssignment(connection.db!, { tenant, bundleId: bundle.bundleId, targetType: 'api_key', targetId: caller.apiKeyId, actorUserId: caller.userId });
  }
  it('review: own scope excludes a non-owner who is another assignee', async () => {
    const { a } = await clients();
    const assetId = await createAsset(a, 'Multiple users');
    const callers = [await createCaller(['read']), await createCaller(['read'])];
    await table('asset_associations').insert(callers.map(c => ({ tenant, asset_id: assetId, entity_id: c.userId, entity_type: 'user', created_by: c.userId })));
    const first = await table('asset_associations').where({ asset_id: assetId }).first('entity_id');
    const caller = callers.find(c => c.userId !== first.entity_id)!;
    await grantTemplate(caller, 'own');
    const previous = globalThis.__algaAuthorizationKernelSingleton;
    const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
    globalThis.__algaAuthorizationKernelSingleton = createEnterpriseAuthorizationKernel();
    try {
      const item = await invoke(assetItemGet, request(caller, `/api/v1/assets/${assetId}`), { id: assetId });
      expect(item.status).toBe(404);
      const response = await invoke(assetGet, request(caller, '/api/v1/assets'));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data.map((r: any) => r.asset_id)).not.toContain(assetId);
    } finally { globalThis.__algaAuthorizationKernelSingleton = previous; }
  }, 180000);
  it('review: own_or_managed scope includes the actual owner consistently with item access', async () => {
    const { a } = await clients();
    const assetId = await createAsset(a, 'Owned asset');
    const caller = await createCaller(['read']);
    await table('asset_associations').insert({ tenant, asset_id: assetId, entity_id: caller.userId, entity_type: 'user', created_by: caller.userId });
    await grantTemplate(caller, 'own_or_managed');
    const previous = globalThis.__algaAuthorizationKernelSingleton;
    const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
    globalThis.__algaAuthorizationKernelSingleton = createEnterpriseAuthorizationKernel();
    try {
      const item = await invoke(assetItemGet, request(caller, `/api/v1/assets/${assetId}`), { id: assetId });
      expect(item.status).toBe(200);
      const response = await invoke(assetGet, request(caller, '/api/v1/assets'));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data.map((r: any) => r.asset_id)).toContain(assetId);
    } finally { globalThis.__algaAuthorizationKernelSingleton = previous; }
  }, 180000);

  it('review: real team membership is available to same_team authorization', async () => {
    const { a } = await clients();
    const assetId = await createAsset(a, 'Team asset');
    const caller = await createCaller(['read']);
    const teamId = randomUUID();
    await table('teams').insert({ tenant, team_id: teamId, team_name: 'Review team', manager_id: caller.userId });
    await table('team_members').insert({ tenant, team_id: teamId, user_id: caller.userId });
    await table('asset_associations').insert({ tenant, asset_id: assetId, entity_id: teamId, entity_type: 'team', created_by: caller.userId });
    await grantTemplate(caller, 'same_team');
    const previous = globalThis.__algaAuthorizationKernelSingleton;
    const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
    globalThis.__algaAuthorizationKernelSingleton = createEnterpriseAuthorizationKernel();
    try {
      const item = await invoke(assetItemGet, request(caller, `/api/v1/assets/${assetId}`), { id: assetId });
      expect(item.status).toBe(200);
      const response = await invoke(assetGet, request(caller, '/api/v1/assets'));
      const body = await response.json();
      expect(body.data.map((r: any) => r.asset_id)).toContain(assetId);
    } finally { globalThis.__algaAuthorizationKernelSingleton = previous; }
  }, 180000);

  it('keeps SQL collection predicates in parity with kernel record checks for supported asset templates', async () => {
    const { a, b } = await clients();
    const caller = await createCaller(['read']);
    const other = await createCaller([]);
    const subordinate = await createCaller([]);
    const owned = await createAsset(a, 'Parity owned');
    const assigned = await createAsset(a, 'Parity assigned');
    const managed = await createAsset(a, 'Parity managed');
    const teamAsset = await createAsset(a, 'Parity team');
    const clientA = await createAsset(a, 'Parity selected client');
    const clientB = await createAsset(b, 'Parity unselected client');
    await table('asset_associations').insert([
      { tenant, asset_id: owned, entity_id: caller.userId, entity_type: 'user', created_by: caller.userId, created_at: new Date('2020-01-01T00:00:00Z') },
      { tenant, asset_id: assigned, entity_id: other.userId, entity_type: 'user', created_by: caller.userId, created_at: new Date('2020-01-01T00:00:00Z') },
      { tenant, asset_id: assigned, entity_id: caller.userId, entity_type: 'user', created_by: caller.userId, created_at: new Date('2020-01-02T00:00:00Z') },
      { tenant, asset_id: managed, entity_id: subordinate.userId, entity_type: 'user', created_by: caller.userId, created_at: new Date('2020-01-01T00:00:00Z') },
    ]);
    await table('users').where({ user_id: subordinate.userId }).update({ reports_to: caller.userId });
    const teamId = randomUUID();
    await table('teams').insert({ tenant, team_id: teamId, team_name: 'Parity team', manager_id: caller.userId });
    await table('team_members').insert({ tenant, team_id: teamId, user_id: caller.userId });
    await table('asset_associations').insert({ tenant, asset_id: teamAsset, entity_id: teamId, entity_type: 'team', created_by: caller.userId });

    const cases = [
      ['own', [owned]],
      ['assigned', [owned, assigned]],
      ['managed', [managed]],
      ['own_or_assigned', [owned, assigned]],
      ['own_or_managed', [owned, managed]],
      ['same_team', [teamAsset]],
      ['selected_clients', [owned, assigned, managed, teamAsset, clientA]],
    ] as const;
    for (const [template, expected] of cases) {
      const scopedCaller = await createCaller(['read']);
      // Reuse the same tenant relationships under the caller whose API key owns the bundle.
      if (template !== 'selected_clients') {
        await table('asset_associations').where({ tenant, entity_id: caller.userId, entity_type: 'user' }).update({ entity_id: scopedCaller.userId, created_by: scopedCaller.userId });
        await table('team_members').where({ tenant, user_id: caller.userId }).update({ user_id: scopedCaller.userId });
        await table('teams').where({ tenant, manager_id: caller.userId }).update({ manager_id: scopedCaller.userId });
        await table('users').where({ reports_to: caller.userId }).update({ reports_to: scopedCaller.userId });
        await table('asset_associations').where({ tenant, entity_id: teamId, entity_type: 'team' }).update({ created_by: scopedCaller.userId });
      }
      await grantTemplate(scopedCaller, template, template === 'selected_clients' ? { selectedClientIds: [a] } : {});
      const priorKernel = globalThis.__algaAuthorizationKernelSingleton;
      const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
      globalThis.__algaAuthorizationKernelSingleton = createEnterpriseAuthorizationKernel();
      try {
        const list = await invoke(assetGet, request(scopedCaller, '/api/v1/assets?limit=50'));
        const ids = new Set((await list.json()).data.map((row: any) => row.asset_id));
        for (const assetId of [owned, assigned, managed, teamAsset, clientA, clientB]) {
          const item = await invoke(assetItemGet, request(scopedCaller, `/api/v1/assets/${assetId}`), { id: assetId });
          expect(ids.has(assetId), `${template}: list result for ${assetId}`).toBe(expected.includes(assetId as never));
          expect(item.status, `${template}: item result for ${assetId}`).toBe(expected.includes(assetId as never) ? 200 : 404);
        }
      } finally { globalThis.__algaAuthorizationKernelSingleton = priorKernel; }
      // Restore the shared relationship fixtures so each template sees an identical principal setup.
      if (template !== 'selected_clients') {
        await table('asset_associations').where({ tenant, entity_id: scopedCaller.userId, entity_type: 'user' }).update({ entity_id: caller.userId, created_by: caller.userId });
        await table('team_members').where({ tenant, user_id: scopedCaller.userId }).update({ user_id: caller.userId });
        await table('teams').where({ tenant, manager_id: scopedCaller.userId }).update({ manager_id: caller.userId });
        await table('users').where({ reports_to: scopedCaller.userId }).update({ reports_to: caller.userId });
        await table('asset_associations').where({ tenant, entity_id: teamId, entity_type: 'team' }).update({ created_by: caller.userId });
      }
    }
  }, 180_000);

  it.each(['own', 'assigned', 'managed', 'own_or_assigned', 'own_or_managed', 'same_team'] as const)(
    'preserves record relationships when authorizing proposed item and bulk updates under %s',
    async (template) => {
      const { a, b } = await clients();
      const deniedClient = randomUUID();
      await table('clients').insert({ tenant, client_id: deniedClient, client_name: 'Outside update scope' });
      const caller = await createCaller(['update']);
      const firstId = await createAsset(a, 'First transition');
      const secondId = await createAsset(a, 'Second transition');
      const unrelatedId = await createAsset(a, 'Unrelated asset');
      let entityId = caller.userId;
      let entityType = 'user';
      if (template === 'managed') {
        const subordinate = await createCaller([]);
        await table('users').where({ user_id: subordinate.userId }).update({ reports_to: caller.userId });
        entityId = subordinate.userId;
      } else if (template === 'same_team') {
        entityId = randomUUID();
        entityType = 'team';
        await table('teams').insert({ tenant, team_id: entityId, team_name: 'Transition team', manager_id: caller.userId });
        await table('team_members').insert({ tenant, team_id: entityId, user_id: caller.userId });
      }
      await table('asset_associations').insert([firstId, secondId].map((assetId) => ({
        tenant, asset_id: assetId, entity_id: entityId, entity_type: entityType, created_by: caller.userId,
      })));

      const bundle = await createAuthorizationBundle(connection.db!, {
        tenant, name: `Transition scope ${randomUUID()}`, actorUserId: caller.userId,
      });
      for (const rule of [
        { templateKey: template, config: {} },
        { templateKey: 'selected_clients' as const, config: { selectedClientIds: [a, b] } },
      ]) {
        await upsertBundleRule(connection.db!, {
          tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
          resourceType: 'asset', action: 'update', actorUserId: caller.userId, ...rule,
        });
      }
      await publishBundleRevision(connection.db! as Knex.Transaction, {
        tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: caller.userId,
      });
      await createBundleAssignment(connection.db!, {
        tenant, bundleId: bundle.bundleId, targetType: 'api_key', targetId: caller.apiKeyId, actorUserId: caller.userId,
      });

      const previousKernel = globalThis.__algaAuthorizationKernelSingleton;
      const { createEnterpriseAuthorizationKernel } = await import('../../../../ee/server/src/lib/authorization/kernel');
      globalThis.__algaAuthorizationKernelSingleton = createEnterpriseAuthorizationKernel();
      const update = (assetId: string, data: Record<string, unknown>) => invoke(
        assetItemPut, request(caller, `/api/v1/assets/${assetId}`, 'PUT', data), { id: assetId },
      );
      const bulk = (assets: Array<{ asset_id: string; data: Record<string, unknown> }>) => invoke(
        bulkUpdate, request(caller, '/api/v1/assets/bulk-update', 'PUT', { assets }),
      );
      const snapshot = () => table('assets').whereIn('asset_id', [firstId, secondId, unrelatedId])
        .select('asset_id', 'client_id', 'name').orderBy('asset_id');
      try {
        expect((await update(firstId, { name: 'Name only' })).status).toBe(200);
        expect((await update(firstId, { name: 'Same client', client_id: a })).status).toBe(200);
        expect((await update(firstId, { name: 'Moved client', client_id: b })).status).toBe(200);
        const allowedBulk = await bulk([
          { asset_id: firstId, data: { name: 'Bulk first', client_id: a } },
          { asset_id: secondId, data: { name: 'Bulk second', client_id: b } },
        ]);
        expect(allowedBulk.status).toBe(200);
        const beforeDenied = await snapshot();
        expect(beforeDenied.find((row) => row.asset_id === firstId)).toMatchObject({ client_id: a, name: 'Bulk first' });
        expect(beforeDenied.find((row) => row.asset_id === secondId)).toMatchObject({ client_id: b, name: 'Bulk second' });

        expect((await update(firstId, { client_id: deniedClient })).status).toBe(404);
        expect((await bulk([
          { asset_id: firstId, data: { name: 'Must stay unchanged', client_id: b } },
          { asset_id: secondId, data: { client_id: deniedClient } },
        ])).status).toBe(404);
        // The proposed client is allowed, but the source record is unrelated to the caller.
        expect((await update(unrelatedId, { client_id: a })).status).toBe(404);
        expect((await bulk([
          { asset_id: firstId, data: { name: 'Must also stay unchanged', client_id: b } },
          { asset_id: unrelatedId, data: { client_id: a } },
        ])).status).toBe(404);
        expect(await snapshot()).toEqual(beforeDenied);
      } finally {
        globalThis.__algaAuthorizationKernelSingleton = previousKernel;
      }
    },
    180_000,
  );
});
