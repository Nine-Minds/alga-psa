import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { createAssetReadContext, isAssetActionAllowed, isAssetReadAllowed } from '@alga-psa/authorization/assetReadAuthorization';
import * as documentAuthorization from '@shared/lib/documentAuthorization';

/**
 * Regression coverage for alga-2026-0002549: getAssetDocuments selected a
 * column (`da.notes`) that does not exist on `document_associations`, so the
 * real query threw on every call. The component tests mock the action, so this
 * test runs the real query against a real database.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const HOOK_TIMEOUT = 180_000;
const actionAuth = vi.hoisted(() => ({ tenant: '', userId: '', userType: 'internal', clientId: '', permissions: {} as Record<string, boolean> }));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
      actionAuth.permissions[`${resource}:${action}`] ?? true),
    withAuth: (action: any) => async (...args: unknown[]) => action(
      { user_id: actionAuth.userId, user_type: actionAuth.userType, clientId: actionAuth.clientId },
      { tenant: actionAuth.tenant },
      ...args,
    ),
  };
});
// Document authorization re-checks asset RBAC for asset-linked documents
// through the authorization package; grant it like the action-level check.
vi.mock('@alga-psa/authorization/rbac', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/authorization/rbac')>(),
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) =>
    actionAuth.permissions[`${resource}:${action}`] ?? true),
}));
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: db, tenant: actionAuth.tenant }),
    withTransaction: async (knex: Knex, callback: (trx: Knex.Transaction) => Promise<unknown>) => knex.transaction(callback),
  };
});

let db: Knex;
let getAssetDocuments: typeof import('@alga-psa/assets/actions/assetDocumentActions').getAssetDocuments;
let associateDocumentWithAsset: typeof import('@alga-psa/assets/actions/assetDocumentActions').associateDocumentWithAsset;
let removeDocumentFromAsset: typeof import('@alga-psa/assets/actions/assetDocumentActions').removeDocumentFromAsset;
let createDocumentAssociations: typeof import('@alga-psa/documents/actions/documentActions').createDocumentAssociations;
let removeDocumentAssociations: typeof import('@alga-psa/documents/actions/documentActions').removeDocumentAssociations;
const columns: Record<string, Record<string, unknown>> = {};
const cleanupTenants = new Set<string>();

function hasColumn(name: string, column: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns[name] ?? {}, column);
}
function table(tenant: string, name: string) {
  return tenantDb(db, tenant).table(name);
}
function unscoped(name: string) {
  return tenantDb(db, '__asset_documents_fixture__').unscoped(name, 'asset documents integration fixture');
}

async function cleanupTenant(tenant: string): Promise<void> {
  const del = async (name: string) => table(tenant, name).del().catch(() => undefined);
  for (const name of [
    'authorization_bundle_assignments', 'authorization_bundle_rules', 'authorization_bundle_revisions',
    'authorization_bundles', 'team_members', 'teams', 'asset_associations',
    'document_associations', 'documents', 'document_types', 'assets', 'clients', 'users',
  ]) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
}

async function setAssetScopes(
  fx: Awaited<ReturnType<typeof seedFixture>>,
  scopes: Partial<Record<'read' | 'update' | 'delete', string[]>>,
): Promise<void> {
  const bundle = await createAuthorizationBundle(db, {
    tenant: fx.tenantId,
    name: `Generic asset document scopes ${randomUUID().slice(0, 8)}`,
    actorUserId: fx.userId,
  });
  for (const [action, selectedClientIds] of Object.entries(scopes)) {
    if (!selectedClientIds) continue;
    await upsertBundleRule(db, {
      tenant: fx.tenantId,
      bundleId: bundle.bundleId,
      revisionId: bundle.revisionId,
      resourceType: 'asset',
      action: action as 'read' | 'update' | 'delete',
      templateKey: 'selected_clients',
      config: { selectedClientIds },
      actorUserId: fx.userId,
    });
  }
  await publishBundleRevision(db, {
    tenant: fx.tenantId,
    bundleId: bundle.bundleId,
    revisionId: bundle.revisionId,
    actorUserId: fx.userId,
  });
  await createBundleAssignment(db, {
    tenant: fx.tenantId,
    bundleId: bundle.bundleId,
    targetType: 'user',
    targetId: fx.userId,
    actorUserId: fx.userId,
  });
}

async function seedFixture() {
  const tenantId = randomUUID();
  cleanupTenants.add(tenantId);
  await unscoped('tenants').insert({
    tenant: tenantId,
    ...(hasColumn('tenants', 'company_name') ? { company_name: 'Asset Documents PSA' } : { client_name: 'Asset Documents PSA' }),
    email: `${tenantId}@example.com`,
    ...(hasColumn('tenants', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('tenants', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const userId = randomUUID();
  await table(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `assetdoc-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Glinda',
    last_name: 'Tester',
    ...(hasColumn('users', 'email') ? { email: `assetdoc-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'internal' } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const clientId = randomUUID();
  const outsiderClientId = randomUUID();
  await table(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Emerald City',
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });
  await table(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: outsiderClientId,
    client_name: 'Other Client',
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const outsiderUserId = randomUUID();
  await table(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: outsiderUserId,
    username: `assetdoc-client-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Client',
    last_name: 'Tester',
    ...(hasColumn('users', 'email') ? { email: `assetdoc-client-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn('users', 'user_type') ? { user_type: 'client' } : {}),
    ...(hasColumn('users', 'client_id') ? { client_id: outsiderClientId } : {}),
    ...(hasColumn('users', 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn('users', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('users', 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  const assetId = randomUUID();
  const otherAssetId = randomUUID();
  const baseAsset = (id: string, tag: string) => ({
    tenant: tenantId,
    asset_id: id,
    asset_tag: tag,
    serial_number: tag,
    name: tag,
    status: 'active',
    asset_type: 'workstation',
    client_id: clientId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await table(tenantId, 'assets').insert([baseAsset(assetId, 'DOC-ASSET'), baseAsset(otherAssetId, 'DOC-OTHER')]);

  const typeId = randomUUID();
  await table(tenantId, 'document_types').insert({
    tenant: tenantId,
    type_id: typeId,
    type_name: 'Knowledge Base',
    icon: 'book',
  });

  const seedDocument = async (name: string, creatorId = userId) => {
    const documentId = randomUUID();
    await table(tenantId, 'documents').insert({
      tenant: tenantId,
      document_id: documentId,
      document_name: name,
      type_id: typeId,
      user_id: creatorId,
      created_by: creatorId,
      entered_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    return documentId;
  };
  const link = async (documentId: string, entityId: string) => {
    const associationId = randomUUID();
    await table(tenantId, 'document_associations').insert({
      tenant: tenantId,
      association_id: associationId,
      document_id: documentId,
      entity_id: entityId,
      entity_type: 'asset',
    });
    return associationId;
  };

  const documentId = await seedDocument('Reset the workstation.md');
  const associationId = await link(documentId, assetId);
  const otherDocumentId = await seedDocument('Other asset runbook.md');
  await link(otherDocumentId, otherAssetId);

  return { tenantId, userId, outsiderUserId, clientId, outsiderClientId, assetId, otherAssetId, documentId, associationId, otherDocumentId, seedDocument, link };
}

describe('getAssetDocuments (integration)', () => {
  beforeEach(() => {
    actionAuth.tenant = '';
    actionAuth.userId = '';
    actionAuth.userType = 'internal';
    actionAuth.clientId = '';
    actionAuth.permissions = {};
  });

  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'test_database';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection({ runSeeds: false });
    for (const name of ['tenants', 'users', 'clients']) {
      columns[name] = await tenantDb(db, '__asset_documents_schema__').unscoped(name, 'schema introspection').columnInfo();
    }
    ({ getAssetDocuments, associateDocumentWithAsset, removeDocumentFromAsset } = await import('@alga-psa/assets/actions/assetDocumentActions'));
    ({ createDocumentAssociations, removeDocumentAssociations } = await import('@alga-psa/documents/actions/documentActions'));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const tenant of cleanupTenants) await cleanupTenant(tenant);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('returns documents linked to the asset without selecting nonexistent columns', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;

    const result = await getAssetDocuments(fx.assetId);

    // An AssetActionError would carry actionError/permissionError instead of being an array.
    expect(Array.isArray(result)).toBe(true);
    const docs = result as Array<Record<string, unknown>>;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      document_id: fx.documentId,
      association_id: fx.associationId,
      document_name: 'Reset the workstation.md',
      type_name: 'Knowledge Base',
      created_by_full_name: 'Glinda Tester',
    });
    expect(docs[0]).not.toHaveProperty('notes');
  });

  it('does not return documents linked to a different asset', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;

    const forOther = (await getAssetDocuments(fx.otherAssetId)) as Array<Record<string, unknown>>;
    expect(forOther.map((d) => d.document_id)).toEqual([fx.otherDocumentId]);

    const forPrimary = (await getAssetDocuments(fx.assetId)) as Array<Record<string, unknown>>;
    expect(forPrimary.map((d) => d.document_id)).not.toContain(fx.otherDocumentId);
  });

  it('stops returning a document once its association is removed', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;

    await table(fx.tenantId, 'document_associations').where({ association_id: fx.associationId }).del();

    expect(await getAssetDocuments(fx.assetId)).toEqual([]);
  });

  it('creates and removes an authorized asset association and persists both outcomes', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;
    actionAuth.userType = 'internal';
    const documentId = await fx.seedDocument('New authorized runbook.md');

    const created = await associateDocumentWithAsset({ entity_id: fx.assetId, document_id: documentId });
    expect(created).toMatchObject({ entity_id: fx.assetId, entity_type: 'asset', document_id: documentId });
    const persisted = await table(fx.tenantId, 'document_associations').where({ association_id: (created as any).association_id }).first();
    expect(persisted).toMatchObject({ entity_id: fx.assetId, entity_type: 'asset', document_id: documentId });

    await removeDocumentFromAsset((created as any).association_id);
    expect(await table(fx.tenantId, 'document_associations').where({ association_id: (created as any).association_id }).first()).toBeUndefined();
  });

  it('requires coarse asset read permission before associating a document', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;
    actionAuth.userType = 'internal';
    actionAuth.permissions = {
      'asset:read': false,
      'asset:update': true,
      'document:read': true,
    };
    const documentId = await fx.seedDocument('Unlinked document denied by coarse asset read.md');
    const countBefore = await table(fx.tenantId, 'document_associations').count('* as count').first();

    const result = await associateDocumentWithAsset({ entity_id: fx.assetId, document_id: documentId });

    expect(result).toHaveProperty('permissionError');
    expect(await table(fx.tenantId, 'document_associations').where({ entity_id: fx.assetId, document_id: documentId }).first()).toBeUndefined();
    expect(await table(fx.tenantId, 'document_associations').count('* as count').first()).toEqual(countBefore);
  });

  it('requires coarse asset read permission before removing an association', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;
    actionAuth.userType = 'internal';
    actionAuth.permissions = {
      'asset:read': false,
      'asset:delete': true,
      'document:read': true,
    };

    const result = await removeDocumentFromAsset(fx.associationId);

    expect(result).toHaveProperty('permissionError');
    expect(await table(fx.tenantId, 'document_associations').where({ association_id: fx.associationId }).first()).toBeDefined();
  });

  it('denies a coarse-permitted client user excluded from the target asset client', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.outsiderUserId;
    actionAuth.userType = 'client';
    actionAuth.clientId = fx.outsiderClientId;
    const documentId = await fx.seedDocument('Attempted cross-client link.md', fx.outsiderUserId);
    const before = await table(fx.tenantId, 'document_associations').count('* as count').first();

    const result = await associateDocumentWithAsset({ entity_id: fx.assetId, document_id: documentId });

    expect(result).toHaveProperty('permissionError');
    expect(Number((await table(fx.tenantId, 'document_associations').count('* as count').first())?.count)).toBe(Number(before?.count));
  });

  it('denies creation when bundle read scope excludes an internal user despite same-team update scope', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;
    actionAuth.userType = 'internal';
    const teamId = randomUUID();
    await table(fx.tenantId, 'teams').insert({
      tenant: fx.tenantId,
      team_id: teamId,
      team_name: `Asset docs team ${teamId.slice(0, 8)}`,
      manager_id: fx.userId,
    });
    await table(fx.tenantId, 'team_members').insert({
      tenant: fx.tenantId,
      team_id: teamId,
      user_id: fx.userId,
    });
    await table(fx.tenantId, 'asset_associations').insert({
      tenant: fx.tenantId,
      asset_id: fx.assetId,
      entity_id: teamId,
      entity_type: 'team',
      created_by: fx.userId,
    });

    const bundle = await createAuthorizationBundle(db, {
      tenant: fx.tenantId,
      name: `Asset document narrowing ${fx.tenantId.slice(0, 8)}`,
      actorUserId: fx.userId,
    });
    await upsertBundleRule(db, {
      tenant: fx.tenantId,
      bundleId: bundle.bundleId,
      revisionId: bundle.revisionId,
      resourceType: 'asset',
      action: 'read',
      templateKey: 'selected_clients',
      config: { selectedClientIds: [fx.outsiderClientId] },
      actorUserId: fx.userId,
    });
    await upsertBundleRule(db, {
      tenant: fx.tenantId,
      bundleId: bundle.bundleId,
      revisionId: bundle.revisionId,
      resourceType: 'asset',
      action: 'update',
      templateKey: 'same_team',
      actorUserId: fx.userId,
    });
    await publishBundleRevision(db, {
      tenant: fx.tenantId,
      bundleId: bundle.bundleId,
      revisionId: bundle.revisionId,
      actorUserId: fx.userId,
    });
    await createBundleAssignment(db, {
      tenant: fx.tenantId,
      bundleId: bundle.bundleId,
      targetType: 'user',
      targetId: fx.userId,
      actorUserId: fx.userId,
    });

    const targetAsset = await table(fx.tenantId, 'assets').where({ asset_id: fx.assetId }).first('asset_id', 'client_id');
    await db.transaction(async (trx) => {
      const context = await createAssetReadContext(trx, fx.tenantId, {
        user_id: fx.userId,
        user_type: 'internal',
      } as any);
      expect(await isAssetReadAllowed(trx, fx.tenantId, context, targetAsset)).toBe(false);
      expect(await isAssetActionAllowed(trx, fx.tenantId, context, targetAsset, 'update')).toBe(false);
    });

    const documentId = await fx.seedDocument('Internal users owned, unassociated.md', fx.userId);
    const before = await table(fx.tenantId, 'document_associations').count('* as count').first();

    const result = await associateDocumentWithAsset({ entity_id: fx.assetId, document_id: documentId });

    expect(result).toHaveProperty('permissionError');
    expect(Number((await table(fx.tenantId, 'document_associations').count('* as count').first())?.count)).toBe(Number(before?.count));
  });

  it('denies an accessible client asset paired with a document outside the caller document policy', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.outsiderUserId;
    actionAuth.userType = 'client';
    actionAuth.clientId = fx.clientId;
    const documentId = await fx.seedDocument('Private internal document.md');
    const before = await table(fx.tenantId, 'document_associations').count('* as count').first();

    const result = await associateDocumentWithAsset({ entity_id: fx.assetId, document_id: documentId });

    expect(result).toHaveProperty('permissionError');
    expect(Number((await table(fx.tenantId, 'document_associations').count('* as count').first())?.count)).toBe(Number(before?.count));
  });

  it('does not remove an association belonging to an asset outside the caller client', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.outsiderUserId;
    actionAuth.userType = 'client';
    actionAuth.clientId = fx.outsiderClientId;

    const result = await removeDocumentFromAsset(fx.associationId);

    expect(result).toHaveProperty('permissionError');
    expect(await table(fx.tenantId, 'document_associations').where({ association_id: fx.associationId }).first()).toBeDefined();
  });

  it('requires asset read scope even when delete is allowed, and removes after read access is restored', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;
    actionAuth.permissions = { 'asset:read': true, 'asset:delete': true, 'document:read': true };

    const bundle = await createAuthorizationBundle(db, {
      tenant: fx.tenantId,
      name: `Asset document removal narrowing ${fx.tenantId.slice(0, 8)}`,
      actorUserId: fx.userId,
    });
    await upsertBundleRule(db, {
      tenant: fx.tenantId,
      bundleId: bundle.bundleId,
      revisionId: bundle.revisionId,
      resourceType: 'asset',
      action: 'read',
      templateKey: 'selected_clients',
      config: { selectedClientIds: [fx.outsiderClientId] },
      actorUserId: fx.userId,
    });
    await publishBundleRevision(db, {
      tenant: fx.tenantId,
      bundleId: bundle.bundleId,
      revisionId: bundle.revisionId,
      actorUserId: fx.userId,
    });
    await createBundleAssignment(db, {
      tenant: fx.tenantId,
      bundleId: bundle.bundleId,
      targetType: 'user',
      targetId: fx.userId,
      actorUserId: fx.userId,
    });

    const targetAsset = await table(fx.tenantId, 'assets').where({ asset_id: fx.assetId }).first('asset_id', 'client_id');
    const expectAssetScope = async (readAllowed: boolean) => {
      await db.transaction(async (trx) => {
        const context = await createAssetReadContext(trx, fx.tenantId, {
          user_id: fx.userId,
          user_type: 'internal',
        } as any);
        expect(await isAssetReadAllowed(trx, fx.tenantId, context, targetAsset)).toBe(readAllowed);
        expect(await isAssetActionAllowed(trx, fx.tenantId, context, targetAsset, 'delete')).toBe(readAllowed);
      });
    };
    await expectAssetScope(false);

    // Keep document access independent so its asset-link policy cannot mask a
    // missing asset authorization check in the mutation itself.
    const documentAccess = vi.spyOn(documentAuthorization, 'authorizeAndRedactDocuments')
      .mockImplementation(async (_trx, _tenant, _user, documents) => documents);
    try {
      expect(await removeDocumentFromAsset(fx.associationId)).toHaveProperty('permissionError');
      expect(await table(fx.tenantId, 'document_associations').where({ association_id: fx.associationId }).first()).toBeDefined();

      await table(fx.tenantId, 'authorization_bundle_assignments')
        .where({ bundle_id: bundle.bundleId, target_type: 'user', target_id: fx.userId }).delete();
      await expectAssetScope(true);

      expect(await removeDocumentFromAsset(fx.associationId)).toBeUndefined();
      expect(await table(fx.tenantId, 'document_associations').where({ association_id: fx.associationId }).first()).toBeUndefined();
    } finally {
      documentAccess.mockRestore();
    }
  });

  it('does not remove an association whose document is inaccessible to the caller', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.outsiderUserId;
    actionAuth.userType = 'client';
    actionAuth.clientId = fx.clientId;
    const privateDocumentId = await fx.seedDocument('Private client runbook.md');
    const associationId = await fx.link(privateDocumentId, fx.assetId);

    const result = await removeDocumentFromAsset(associationId);

    expect(result).toHaveProperty('permissionError');
    expect(await table(fx.tenantId, 'document_associations').where({ association_id: associationId }).first()).toBeDefined();
  });

  it('requires coarse document read permission before removal', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;
    actionAuth.userType = 'internal';
    actionAuth.permissions = { 'asset:read': true, 'asset:delete': true, 'document:read': false };

    const result = await removeDocumentFromAsset(fx.associationId);

    expect(result).toHaveProperty('permissionError');
    expect(await table(fx.tenantId, 'document_associations').where({ association_id: fx.associationId }).first()).toBeDefined();
  });

  it('does not remove a non-asset association', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;
    actionAuth.userType = 'internal';
    const associationId = randomUUID();
    await table(fx.tenantId, 'document_associations').insert({
      tenant: fx.tenantId, association_id: associationId, document_id: fx.documentId,
      entity_id: randomUUID(), entity_type: 'ticket',
    });

    const result = await removeDocumentFromAsset(associationId);

    expect(result).toHaveProperty('permissionError');
    expect(await table(fx.tenantId, 'document_associations').where({ association_id: associationId }).first()).toBeDefined();
  });

  it('denies missing and cross-tenant identifiers without changing associations', async () => {
    const local = await seedFixture();
    const foreign = await seedFixture();
    actionAuth.tenant = local.tenantId;
    actionAuth.userId = local.userId;
    actionAuth.userType = 'internal';
    const before = await table(local.tenantId, 'document_associations').count('* as count').first();

    expect(await associateDocumentWithAsset({ entity_id: '', document_id: '' })).toHaveProperty('permissionError');
    expect(await associateDocumentWithAsset({ entity_id: randomUUID(), document_id: local.documentId })).toHaveProperty('permissionError');
    expect(await associateDocumentWithAsset({ entity_id: local.assetId, document_id: randomUUID() })).toHaveProperty('permissionError');
    expect(await associateDocumentWithAsset({ entity_id: local.assetId, document_id: foreign.documentId })).toHaveProperty('permissionError');
    expect(await associateDocumentWithAsset({ entity_id: foreign.assetId, document_id: foreign.documentId })).toHaveProperty('permissionError');
    expect(await removeDocumentFromAsset(randomUUID())).toHaveProperty('permissionError');
    expect(await removeDocumentFromAsset('')).toHaveProperty('permissionError');
    expect(await removeDocumentFromAsset(foreign.associationId)).toHaveProperty('permissionError');

    expect(Number((await table(local.tenantId, 'document_associations').count('* as count').first())?.count)).toBe(Number(before?.count));
    expect(await table(foreign.tenantId, 'document_associations').where({ association_id: foreign.associationId }).first()).toBeDefined();
  });

  it('generic creation requires both asset read and update record scopes', async () => {
    for (const deniedAction of ['read', 'update'] as const) {
      const fx = await seedFixture();
      actionAuth.tenant = fx.tenantId;
      actionAuth.userId = fx.userId;
      actionAuth.userType = 'internal';
      await setAssetScopes(fx, {
        read: deniedAction === 'read' ? [fx.outsiderClientId] : [fx.clientId],
        update: deniedAction === 'update' ? [fx.outsiderClientId] : [fx.clientId],
      });
      const documentId = await fx.seedDocument(`Generic create denied by ${deniedAction}.md`);

      const result = await createDocumentAssociations(fx.assetId, 'asset', [documentId]);

      expect(result).toHaveProperty('permissionError');
      expect(await table(fx.tenantId, 'document_associations').where({ entity_id: fx.assetId, document_id: documentId }).first()).toBeUndefined();
    }
  });

  it('generic creation rechecks asset read scope after the picker selected the asset', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;
    actionAuth.userType = 'internal';
    const documentId = await fx.seedDocument('Owned document selected before asset scope changed.md', fx.userId);
    const asset = await table(fx.tenantId, 'assets').where({ asset_id: fx.assetId }).first('asset_id', 'client_id');

    await db.transaction(async (trx) => {
      const context = await createAssetReadContext(trx, fx.tenantId, {
        user_id: fx.userId,
        user_type: 'internal',
      } as any);
      expect(await isAssetReadAllowed(trx, fx.tenantId, context, asset)).toBe(true);
    });

    // The user already selected these identifiers while the asset was readable.
    await setAssetScopes(fx, { read: [fx.outsiderClientId] });
    await db.transaction(async (trx) => {
      const context = await createAssetReadContext(trx, fx.tenantId, {
        user_id: fx.userId,
        user_type: 'internal',
      } as any);
      expect(await isAssetReadAllowed(trx, fx.tenantId, context, asset)).toBe(false);
    });

    const result = await createDocumentAssociations(fx.assetId, 'asset', [documentId]);

    expect(result).toHaveProperty('permissionError');
    expect(await table(fx.tenantId, 'document_associations')
      .where({ entity_id: fx.assetId, entity_type: 'asset', document_id: documentId }).first()).toBeUndefined();
  });

  it('generic creation checks document permission and visibility before inserting any batch row', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.outsiderUserId;
    actionAuth.userType = 'client';
    actionAuth.clientId = fx.clientId;
    const ownedDocumentId = await fx.seedDocument('Owned selected document.md', fx.outsiderUserId);
    const privateDocumentId = await fx.seedDocument('Private selected document.md', fx.userId);
    actionAuth.permissions = { 'document:read': false, 'document:update': true };
    const initialAssociationCount = await table(fx.tenantId, 'document_associations').where({ entity_id: fx.assetId }).count('* as count').first();

    const permissionDenied = await createDocumentAssociations(fx.assetId, 'asset', [ownedDocumentId]);
    actionAuth.permissions = { 'document:read': true, 'document:update': true };
    const visibilityDenied = await createDocumentAssociations(fx.assetId, 'asset', [ownedDocumentId, privateDocumentId]);

    expect(permissionDenied).toHaveProperty('permissionError');
    expect(visibilityDenied).toHaveProperty('permissionError');
    expect(await table(fx.tenantId, 'document_associations').where({ entity_id: fx.assetId }).count('* as count').first()).toEqual(initialAssociationCount);
    expect(await table(fx.tenantId, 'document_associations').whereIn('document_id', [ownedDocumentId, privateDocumentId]).first()).toBeUndefined();
  });

  it('generic removal requires both asset read and delete record scopes and preserves rows on denial', async () => {
    for (const deniedAction of ['read', 'delete'] as const) {
      const fx = await seedFixture();
      actionAuth.tenant = fx.tenantId;
      actionAuth.userId = fx.userId;
      actionAuth.userType = 'internal';
      await setAssetScopes(fx, {
        read: deniedAction === 'read' ? [fx.outsiderClientId] : [fx.clientId],
        delete: deniedAction === 'delete' ? [fx.outsiderClientId] : [fx.clientId],
      });
      const associationBefore = await table(fx.tenantId, 'document_associations')
        .where({ association_id: fx.associationId }).first();

      const result = await removeDocumentAssociations(fx.assetId, 'asset', [fx.documentId]);

      expect(result).toHaveProperty('permissionError');
      expect(await table(fx.tenantId, 'document_associations').where({ association_id: fx.associationId }).first()).toEqual(associationBefore);
    }
  });

  it('generic removal checks document permission and visibility atomically across the selected rows', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.outsiderUserId;
    actionAuth.userType = 'client';
    actionAuth.clientId = fx.clientId;
    const ownDocumentId = await fx.seedDocument('Owned linked document.md', fx.outsiderUserId);
    const privateDocumentId = await fx.seedDocument('Private linked document.md', fx.userId);
    const ownAssociationId = await fx.link(ownDocumentId, fx.assetId);
    const privateAssociationId = await fx.link(privateDocumentId, fx.assetId);
    actionAuth.permissions = { 'document:read': false, 'document:update': true };

    const permissionDenied = await removeDocumentAssociations(fx.assetId, 'asset', [ownDocumentId]);
    actionAuth.permissions = { 'document:read': true, 'document:update': true };
    const visibilityDenied = await removeDocumentAssociations(fx.assetId, 'asset', [ownDocumentId, privateDocumentId]);

    expect(permissionDenied).toHaveProperty('permissionError');
    expect(visibilityDenied).toHaveProperty('permissionError');
    expect(await table(fx.tenantId, 'document_associations').whereIn('association_id', [ownAssociationId, privateAssociationId]).orderBy('association_id')).toHaveLength(2);
  });

  it('generic asset association actions reject invalid and inaccessible identifiers without changing persisted rows', async () => {
    const local = await seedFixture();
    const foreign = await seedFixture();
    actionAuth.tenant = local.tenantId;
    actionAuth.userId = local.userId;
    actionAuth.userType = 'internal';

    expect(await createDocumentAssociations(local.assetId, 'invalid' as any, [local.documentId])).toHaveProperty('permissionError');
    expect(await createDocumentAssociations(randomUUID(), 'asset', [local.documentId])).toHaveProperty('permissionError');
    expect(await createDocumentAssociations(local.assetId, 'asset', [foreign.documentId])).toHaveProperty('permissionError');
    expect(await removeDocumentAssociations(local.assetId, 'invalid' as any, [local.documentId])).toHaveProperty('permissionError');
    expect(await removeDocumentAssociations(foreign.assetId, 'asset', [foreign.documentId])).toMatchObject({ success: true });
    expect(await removeDocumentAssociations(local.assetId, 'asset', [randomUUID()])).toMatchObject({ success: true });

    expect(await table(local.tenantId, 'document_associations').where({ association_id: local.associationId }).first()).toBeDefined();
    expect(await table(foreign.tenantId, 'document_associations').where({ association_id: foreign.associationId }).first()).toBeDefined();
  });

  it('generic creation and removal persist authorized outcomes', async () => {
    const fx = await seedFixture();
    actionAuth.tenant = fx.tenantId;
    actionAuth.userId = fx.userId;
    actionAuth.userType = 'internal';
    const documentId = await fx.seedDocument('Generic authorized association.md');

    expect(await createDocumentAssociations(fx.assetId, 'asset', [documentId])).toMatchObject({ success: true });
    const created = await table(fx.tenantId, 'document_associations').where({ entity_id: fx.assetId, document_id: documentId, entity_type: 'asset' }).first();
    expect(created).toBeDefined();

    expect(await removeDocumentAssociations(fx.assetId, 'asset', [documentId])).toMatchObject({ success: true });
    expect(await table(fx.tenantId, 'document_associations').where({ association_id: created.association_id }).first()).toBeUndefined();
  });
});
