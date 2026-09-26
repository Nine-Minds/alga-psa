import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const TARGET_MIGRATION = '20260923090000_consolidate_client_tax_id.cjs';
const MIGRATIONS_DIR = path.resolve(__dirname, '..');
const MIGRATION = require(path.join(MIGRATIONS_DIR, TARGET_MIGRATION));

let db: Knex;
let tenantA: string;
let tenantB: string;
let idsA: Record<string, string>;
let idsB: Record<string, string>;
let preMigrationDir: string;

async function addTenant(tenant: string) {
  await db('tenants').insert({
    tenant,
    client_name: `Tax Migration ${tenant.slice(0, 8)}`,
    email: `tax-migration-${tenant.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function addClients(tenant: string, ids: Record<string, string>) {
  const fixtures = [
    ['conflict', 'CANONICAL', { tax_id: ' DISCARDED ' }],
    ['backfill', null, { tax_id: ' BACKFILLED ' }],
    ['blankLegacy', 'CANONICAL', { tax_id: '   ' }],
    ['sameTrimmed', ' SAME ', { tax_id: 'SAME' }],
    ['nullProperties', null, null],
    ['missingProperties', null, undefined],
    ['blankColumn', '   ', { tax_id: ' VALUE ' }],
    ['emptyLegacy', 'CANONICAL', { tax_id: null }],
  ] as const;
  await db('clients').insert(fixtures.filter(([key]) => ids[key]).map(([key, tax_id_number, properties]) => ({
    tenant,
    client_id: ids[key],
    client_name: `Tax ${key} ${tenant.slice(0, 8)}`,
    is_inactive: false,
    tax_id_number,
    properties,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  })));
}

async function runTenant(tenant: string) {
  await MIGRATION.consolidateTenant(db, tenant);
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  // Bootstrap a fresh suite database with every migration before the target.
  preMigrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-tax-id-pre-migration-'));
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((name) => name < TARGET_MIGRATION && name.endsWith('.cjs'))) {
    fs.writeFileSync(path.join(preMigrationDir, file), `module.exports = require(${JSON.stringify(path.join(MIGRATIONS_DIR, file))});\n`);
  }
  db = await createTestDbConnection({ migrationsDir: preMigrationDir, runSeeds: false });
  fs.writeFileSync(path.join(preMigrationDir, TARGET_MIGRATION), `module.exports = require(${JSON.stringify(path.join(MIGRATIONS_DIR, TARGET_MIGRATION))});\n`);
  tenantA = randomUUID();
  tenantB = randomUUID();
  idsA = Object.fromEntries(['conflict', 'backfill', 'blankLegacy', 'sameTrimmed', 'nullProperties', 'missingProperties', 'blankColumn', 'emptyLegacy'].map((key) => [key, randomUUID()]));
  idsB = { conflict: randomUUID() };
  await addTenant(tenantA);
  await addClients(tenantA, idsA);

  // Exercise the actual Knex migration runner after seeding rows that predate it.
  const result = await db.migrate.up({ directory: preMigrationDir, name: TARGET_MIGRATION });
  expect(result[1]).toContain(TARGET_MIGRATION);
  const history = await db('knex_migrations').where({ name: TARGET_MIGRATION }).first();
  expect(history).toBeTruthy();
  await addTenant(tenantB);
  await addClients(tenantB, idsB);
}, 300_000);

afterAll(async () => {
  if (db) {
    await db('client_tax_id_migration_conflicts').whereIn('tenant', [tenantA, tenantB]).del().catch(() => undefined);
    await db('clients').whereIn('tenant', [tenantA, tenantB]).del().catch(() => undefined);
    await db('tenants').whereIn('tenant', [tenantA, tenantB]).del().catch(() => undefined);
    await db.destroy().catch(() => undefined);
  }
  if (preMigrationDir) fs.rmSync(preMigrationDir, { recursive: true, force: true });
});

describe('client Tax ID consolidation migration', () => {
  it('records conflicts before removing the key, backfills eligible values, and leaves non-conflicts unaudited', async () => {
    const conflict = await db('clients').where({ tenant: tenantA, client_id: idsA.conflict }).first();
    expect(conflict.tax_id_number).toBe('CANONICAL');
    expect(conflict.properties).not.toHaveProperty('tax_id');
    expect(conflict.properties).not.toHaveProperty(['legacy', 'tax', 'id'].join('_'));
    expect(conflict.properties).toEqual({});
    const auditRows = await db('client_tax_id_migration_conflicts').where({ tenant: tenantA }).select('*');
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      tenant: tenantA,
      client_id: idsA.conflict,
      client_name: `Tax conflict ${tenantA.slice(0, 8)}`,
      canonical_value: 'CANONICAL',
      discarded_legacy_value: 'DISCARDED',
    });
    expect(auditRows[0].migrated_at).toBeTruthy();

    const backfill = await db('clients').where({ tenant: tenantA, client_id: idsA.backfill }).first();
    expect(backfill.tax_id_number).toBe('BACKFILLED');
    expect(backfill.properties).not.toHaveProperty('tax_id');
    const blankColumn = await db('clients').where({ tenant: tenantA, client_id: idsA.blankColumn }).first();
    expect(blankColumn.tax_id_number).toBe('VALUE');
    for (const key of ['blankLegacy', 'sameTrimmed', 'nullProperties', 'missingProperties', 'blankColumn', 'emptyLegacy']) {
      const row = await db('clients').where({ tenant: tenantA, client_id: idsA[key] }).first();
      if (key === 'nullProperties' || key === 'missingProperties') expect(row.properties).toBeNull();
      else expect(row.properties).not.toHaveProperty('tax_id');
    }
    expect(await db('client_tax_id_migration_conflicts').where({ tenant: tenantA }).count('* as count').first()).toMatchObject({ count: '1' });
  });

  it('is idempotent and isolates direct tenant reruns', async () => {
    const beforeA = await db('clients').where({ tenant: tenantA }).orderBy('client_id').select('*');
    const beforeAudit = await db('client_tax_id_migration_conflicts').where({ tenant: tenantA }).orderBy('client_id').select('*');
    await runTenant(tenantA);
    const afterA = await db('clients').where({ tenant: tenantA }).orderBy('client_id').select('*');
    const afterAudit = await db('client_tax_id_migration_conflicts').where({ tenant: tenantA }).orderBy('client_id').select('*');
    expect(afterA).toEqual(beforeA);
    expect(afterAudit).toEqual(beforeAudit);

    const otherBefore = await db('clients').where({ tenant: tenantB }).first();
    expect(otherBefore.properties).toHaveProperty('tax_id', ' DISCARDED ');
    expect(await db('client_tax_id_migration_conflicts').where({ tenant: tenantB })).toHaveLength(0);
    await runTenant(tenantA);
    expect(await db('clients').where({ tenant: tenantB }).first()).toEqual(otherBefore);
    await runTenant(tenantB);
    const otherAfter = await db('clients').where({ tenant: tenantB }).first();
    expect(otherAfter.properties).not.toHaveProperty('tax_id');
    expect(otherAfter.tax_id_number).toBe('CANONICAL');
    expect(await db('client_tax_id_migration_conflicts').where({ tenant: tenantB })).toHaveLength(1);
  });

  it('records the migration in Knex history and a second runner call is a no-op', async () => {
    const before = await db('client_tax_id_migration_conflicts').count('* as count').first();
    const secondRun = await db.migrate.latest({ directory: preMigrationDir });
    expect(secondRun[1]).toEqual([]);
    expect(await db('client_tax_id_migration_conflicts').count('* as count').first()).toEqual(before);
  });
});
