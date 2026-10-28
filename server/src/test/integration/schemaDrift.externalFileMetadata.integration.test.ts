import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { FileStoreModel } from '@alga-psa/storage/models/storage';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

/**
 * Schema-drift guard (D1). Code reads and writes columns that no migration
 * used to create. These tests go through the real model against a migrated
 * database and read the row back with a separate query, so a missing column or
 * a model that drops the value fails here (a mock assertion would not).
 *
 * The D2 guard (stripe_subscriptions, an EE table) lives in the enterprise
 * integration lane: ee/server/src/__tests__/integration/
 * schemaDrift.stripeSubscriptionItemId.integration.test.ts.
 */
let conn: Knex;
const tenant = randomUUID();
const actor = randomUUID();

beforeAll(async () => {
  conn = await createTestDbConnection();
  await tenantDb(conn, tenant)
    .unscoped('tenants', 'create isolated test tenant')
    .insert({ tenant, client_name: 'Schema drift', email: `${tenant}@example.test`, product_code: 'psa' });
  await tenantDb(conn, tenant).table('users').insert({
    tenant, user_id: actor, username: actor, email: `${actor}@example.test`,
    hashed_password: 'unused', user_type: 'internal', is_inactive: false,
  });
}, 180_000);

afterAll(async () => {
  if (!conn) return;
  await tenantDb(conn, tenant).table('external_files').where({ tenant }).delete().catch(() => {});
  await tenantDb(conn, tenant).table('users').where({ tenant }).delete().catch(() => {});
  await tenantDb(conn, tenant).unscoped('tenants', 'drop isolated test tenant').where({ tenant }).delete().catch(() => {});
  await conn.destroy();
});

const fileInput = (metadata?: Record<string, unknown>) => ({
  fileId: randomUUID(), file_name: 'a.txt', original_name: 'a.txt', mime_type: 'text/plain',
  file_size: 3, storage_path: `/test/${randomUUID()}`, uploaded_by_id: actor, ...(metadata ? { metadata } : {}),
});

const readBack = (fileId: string) =>
  tenantDb(conn, tenant).table('external_files').where({ file_id: fileId }).first();

describe('external_files.metadata (D1)', () => {
  it('FileStoreModel.create persists metadata instead of dropping it', async () => {
    const metadata = { source: 'create', nested: { n: 1 } };
    const created = await runWithTenant(tenant, () => FileStoreModel.create(conn, fileInput(metadata)));

    const row = await readBack(created.file_id);
    expect(row.metadata).toEqual(metadata);
  });

  it('FileStoreModel.updateMetadata writes to a column that exists', async () => {
    const created = await runWithTenant(tenant, () => FileStoreModel.create(conn, fileInput()));
    expect((await readBack(created.file_id)).metadata).toBeNull();

    await runWithTenant(tenant, () => FileStoreModel.updateMetadata(conn, created.file_id, { audited: true }));

    expect((await readBack(created.file_id)).metadata).toEqual({ audited: true });
  });
});
