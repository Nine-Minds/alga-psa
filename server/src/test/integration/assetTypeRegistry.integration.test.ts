import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const serverRoot = path.resolve(__dirname, '../../..');
const repoRoot = path.resolve(serverRoot, '..');
const migrationPath = path.join(serverRoot, 'migrations/20260612120000_create_asset_type_registry.cjs');
const onboardingSeedPath = path.join(repoRoot, 'ee/server/seeds/onboarding/psa/09_asset_type_registry.cjs');

const EXPECTED_BUILTINS = [
  { slug: 'workstation', name: 'Workstation', display_order: 0 },
  { slug: 'network_device', name: 'Network Device', display_order: 1 },
  { slug: 'server', name: 'Server', display_order: 2 },
  { slug: 'mobile_device', name: 'Mobile Device', display_order: 3 },
  { slug: 'printer', name: 'Printer', display_order: 4 },
  { slug: 'unknown', name: 'Unknown', display_order: 5 },
];

let db: Knex;
let tenantColumns: Record<string, unknown>;
const tenantsToCleanup = new Set<string>();

function hasColumn(columns: Record<string, unknown>, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

async function seedTenant(): Promise<string> {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);

  await db('tenants').insert({
    tenant: tenantId,
    ...(hasColumn(tenantColumns, 'company_name')
      ? { company_name: `Tenant ${tenantId.slice(0, 8)}` }
      : { client_name: `Tenant ${tenantId.slice(0, 8)}` }),
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return tenantId;
}

async function fetchRegistryRows(tenantId: string) {
  return db('asset_type_registry')
    .where({ tenant: tenantId })
    .orderBy('display_order', 'asc')
    .select('slug', 'name', 'is_builtin', 'display_order', 'fields_schema', 'icon');
}

function expectSixBuiltins(rows: Array<Record<string, any>>) {
  expect(rows).toHaveLength(6);
  expect(rows.map((row) => [row.slug, row.name, row.display_order])).toEqual(
    EXPECTED_BUILTINS.map((builtin) => [builtin.slug, builtin.name, builtin.display_order])
  );
  expect(rows.every((row) => row.is_builtin === true)).toBe(true);
  expect(rows.every((row) => Array.isArray(row.fields_schema) && row.fields_schema.length === 0)).toBe(true);
}

describe('asset_type_registry migration artifacts and seeding', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
  }, 300_000);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await db('asset_type_registry').where({ tenant: tenantId }).delete().catch(() => undefined);
      await db('tenants').where({ tenant: tenantId }).delete().catch(() => undefined);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  it('T301: migration creates the table with expected columns, keys, unique (tenant, slug), and RLS policies', async () => {
    expect(await db.schema.hasTable('asset_type_registry')).toBe(true);

    const columns = await db.raw(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'asset_type_registry'
      ORDER BY ordinal_position
    `);
    const byName = Object.fromEntries(columns.rows.map((row: any) => [row.column_name, row]));

    expect(columns.rows[0].column_name).toBe('tenant');
    expect(byName.tenant).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(byName.type_id).toMatchObject({ data_type: 'uuid', is_nullable: 'NO' });
    expect(byName.type_id.column_default).toContain('gen_random_uuid');
    expect(byName.slug).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName.name).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(byName.icon).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(byName.fields_schema).toMatchObject({ data_type: 'jsonb', is_nullable: 'NO' });
    expect(byName.fields_schema.column_default).toContain("'[]'::jsonb");
    expect(byName.is_builtin).toMatchObject({ data_type: 'boolean', is_nullable: 'NO' });
    expect(byName.display_order).toMatchObject({ data_type: 'integer', is_nullable: 'NO' });
    expect(byName.created_at.is_nullable).toBe('NO');
    expect(byName.updated_at.is_nullable).toBe('NO');

    const constraints = await db.raw(`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'asset_type_registry'::regclass
    `);
    const defs = constraints.rows.map((row: any) => row.def);
    expect(defs).toContain('PRIMARY KEY (tenant, type_id)');
    expect(defs).toContain('UNIQUE (tenant, slug)');

    const rls = await db.raw(`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'asset_type_registry'
    `);
    expect(rls.rows[0].relrowsecurity).toBe(true);

    const policies = await db.raw(`
      SELECT policyname FROM pg_policies WHERE tablename = 'asset_type_registry'
    `);
    const policyNames = policies.rows.map((row: any) => row.policyname);
    expect(policyNames).toContain('tenant_isolation_policy');
    expect(policyNames).toContain('tenant_isolation_insert_policy');
  });

  it('T301: unique (tenant, slug) rejects duplicates while the same slug is fine on another tenant', async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();

    await db('asset_type_registry').insert({ tenant: tenantA, slug: 'door_access', name: 'Door Access' });
    await expect(
      db('asset_type_registry').insert({ tenant: tenantA, slug: 'door_access', name: 'Door Access Again' })
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db('asset_type_registry').insert({ tenant: tenantB, slug: 'door_access', name: 'Door Access' })
    ).resolves.toBeDefined();
  });

  it('T302: migration up() seeds the six built-ins for existing tenants and is idempotent', async () => {
    const tenantId = await seedTenant();
    const migration = require(migrationPath);

    await migration.up(db);
    expectSixBuiltins(await fetchRegistryRows(tenantId));

    await migration.up(db);
    expectSixBuiltins(await fetchRegistryRows(tenantId));
  });

  it('T302: onboarding seed covers tenants created after the migration ran, and is idempotent', async () => {
    expect(existsSync(onboardingSeedPath)).toBe(true);

    const tenantId = await seedTenant();
    expect(await fetchRegistryRows(tenantId)).toHaveLength(0);

    const { seed } = require(onboardingSeedPath);
    await seed(db, tenantId);
    expectSixBuiltins(await fetchRegistryRows(tenantId));

    await seed(db, tenantId);
    expectSixBuiltins(await fetchRegistryRows(tenantId));
  });

  it('T301: migration down() drops the table and up() restores it', async () => {
    const migration = require(migrationPath);

    await migration.down(db);
    expect(await db.schema.hasTable('asset_type_registry')).toBe(false);

    await migration.up(db);
    expect(await db.schema.hasTable('asset_type_registry')).toBe(true);

    const policies = await db.raw(`
      SELECT policyname FROM pg_policies WHERE tablename = 'asset_type_registry'
    `);
    expect(policies.rows.map((row: any) => row.policyname)).toEqual(
      expect.arrayContaining(['tenant_isolation_policy', 'tenant_isolation_insert_policy'])
    );
  });
});
