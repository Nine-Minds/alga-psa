import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const MIGRATION_PATH = path.resolve(__dirname, '../20260812090200_add_sales_orders_default_folder.cjs');
const FOLDER_PATH = '/Clients/Sales Orders';

let db: Knex;
const preexistingTenantId = randomUUID();
const createdTenantId = randomUUID();
const preexistingFolderId = randomUUID();

const migration = require(MIGRATION_PATH) as {
  up: (knex: Knex) => Promise<void>;
  down: (knex: Knex) => Promise<void>;
};

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();

  await db('tenants').insert([
    {
      tenant: preexistingTenantId,
      client_name: 'Pre-existing Sales Orders Folder Test',
      email: `sales-orders-preexisting-${preexistingTenantId.slice(0, 8)}@example.com`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
    {
      tenant: createdTenantId,
      client_name: 'Migration-created Sales Orders Folder Test',
      email: `sales-orders-created-${createdTenantId.slice(0, 8)}@example.com`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    },
  ]);

  await db('document_default_folders').insert({
    tenant: preexistingTenantId,
    default_folder_id: preexistingFolderId,
    entity_type: 'client',
    folder_path: FOLDER_PATH,
    folder_name: 'Sales Orders',
    is_client_visible: false,
    sort_order: 9,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}, 300_000);

afterAll(async () => {
  if (!db) return;

  // Leave the migration applied for any later suite sharing this database,
  // then remove only this suite's tenant fixtures.
  await migration.up(db);
  await db('document_default_folders').whereIn('tenant', [preexistingTenantId, createdTenantId]).del();
  await db('tenants').whereIn('tenant', [preexistingTenantId, createdTenantId]).del();
  await db.destroy().catch(() => undefined);
});

describe('Sales Orders default folder migration rollback', () => {
  it('preserves a matching pre-existing folder and removes only the folder created by up', async () => {
    await migration.up(db);

    const preexistingAfterUp = await db('document_default_folders')
      .where({
        tenant: preexistingTenantId,
        entity_type: 'client',
        folder_path: FOLDER_PATH,
      })
      .first();
    const createdAfterUp = await db('document_default_folders')
      .where({
        tenant: createdTenantId,
        entity_type: 'client',
        folder_path: FOLDER_PATH,
      })
      .first();

    expect(preexistingAfterUp?.default_folder_id).toBe(preexistingFolderId);
    expect(createdAfterUp).toBeDefined();

    await migration.down(db);

    const preexistingAfterDown = await db('document_default_folders')
      .where({
        tenant: preexistingTenantId,
        default_folder_id: preexistingFolderId,
      })
      .first();
    const createdAfterDown = await db('document_default_folders')
      .where({
        tenant: createdTenantId,
        default_folder_id: createdAfterUp.default_folder_id,
      })
      .first();

    expect(preexistingAfterDown).toBeDefined();
    expect(createdAfterDown).toBeUndefined();
  });
});
