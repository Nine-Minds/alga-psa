import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

/**
 * Regression coverage for alga-2026-0002549: getAssetDocuments selected a
 * column (`da.notes`) that does not exist on `document_associations`, so the
 * real query threw on every call. The component tests mock the action, so this
 * test runs the real query against a real database.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const HOOK_TIMEOUT = 180_000;
const actionAuth = vi.hoisted(() => ({ tenant: '', userId: '' }));

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    hasPermission: vi.fn().mockResolvedValue(true),
    withAuth: (action: any) => async (...args: unknown[]) => action(
      { user_id: actionAuth.userId },
      { tenant: actionAuth.tenant },
      ...args,
    ),
  };
});
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
  for (const name of ['document_associations', 'documents', 'document_types', 'assets', 'clients', 'users']) {
    await del(name);
  }
  await unscoped('tenants').where({ tenant }).del().catch(() => undefined);
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
  await table(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: 'Emerald City',
    ...(hasColumn('clients', 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn('clients', 'updated_at') ? { updated_at: db.fn.now() } : {}),
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

  const seedDocument = async (name: string) => {
    const documentId = randomUUID();
    await table(tenantId, 'documents').insert({
      tenant: tenantId,
      document_id: documentId,
      document_name: name,
      type_id: typeId,
      user_id: userId,
      created_by: userId,
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

  return { tenantId, userId, assetId, otherAssetId, documentId, associationId, otherDocumentId };
}

describe('getAssetDocuments (integration)', () => {
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
    ({ getAssetDocuments } = await import('@alga-psa/assets/actions/assetDocumentActions'));
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
});
