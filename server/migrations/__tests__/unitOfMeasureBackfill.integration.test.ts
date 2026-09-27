import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';
import { registerTenantUnit } from '../../../shared/billingClients/tenantUnitsOfMeasure';

const require = createRequire(import.meta.url);
const MIGRATIONS_DIR = path.resolve(__dirname, '..');
const VOCABULARY = require(path.join(MIGRATIONS_DIR, '20260927100000_create_units_of_measure_vocabulary.cjs'));
const BACKFILL = require(path.join(MIGRATIONS_DIR, '20260927110000_add_unit_codes_and_backfill.cjs'));
const DB_NAME = 'test_db_uom_backfill';
const tenant = randomUUID();
let db: Knex;
let scratchMigrationsDir: string;
let scratchSeedsDir: string;

beforeAll(async () => {
  wireLocalTestDbEnv();
  scratchMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uom-backfill-migrations-'));
  scratchSeedsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uom-backfill-seeds-'));
  const setupPath = path.join(scratchMigrationsDir, '20260926080000_uom_fixture_tables.cjs');
  fs.writeFileSync(setupPath, `exports.up = async (knex) => {
    await knex.schema.createTable('service_catalog', table => {
      table.uuid('tenant').notNullable(); table.uuid('service_id').notNullable();
      table.text('unit_of_measure'); table.primary(['tenant', 'service_id']);
    });
    await knex.schema.createTable('contract_line_service_usage_config', table => {
      table.uuid('tenant').notNullable(); table.uuid('config_id').notNullable();
      table.text('unit_of_measure'); table.primary(['tenant', 'config_id']);
    });
    const tenant = ${JSON.stringify(tenant)};
    await knex('service_catalog').insert([
      { tenant, service_id: '${randomUUID()}', unit_of_measure: 'EA' },
      { tenant, service_id: '${randomUUID()}', unit_of_measure: ' each ' },
      { tenant, service_id: '${randomUUID()}', unit_of_measure: 'Hrs' },
      { tenant, service_id: '${randomUUID()}', unit_of_measure: 'GB' },
      { tenant, service_id: '${randomUUID()}', unit_of_measure: 'Widgets' },
      { tenant, service_id: '${randomUUID()}', unit_of_measure: 'Seats' },
    ]);
    await knex('contract_line_service_usage_config').insert([
      { tenant, config_id: '${randomUUID()}', unit_of_measure: 'EA' },
      { tenant, config_id: '${randomUUID()}', unit_of_measure: 'Hrs' },
    ]);
  };
  exports.down = async knex => { await knex.schema.dropTableIfExists('contract_line_service_usage_config'); await knex.schema.dropTableIfExists('service_catalog'); };
`);
  for (const name of ['20260927100000_create_units_of_measure_vocabulary.cjs', '20260927110000_add_unit_codes_and_backfill.cjs']) {
    fs.writeFileSync(path.join(scratchMigrationsDir, name), `module.exports = require(${JSON.stringify(path.join(MIGRATIONS_DIR, name))});\n`);
  }
  db = await createTestDbConnection({ databaseName: DB_NAME, migrationsDir: scratchMigrationsDir, seedsDir: scratchSeedsDir, runSeeds: false });
}, 300_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
  if (scratchMigrationsDir) fs.rmSync(scratchMigrationsDir, { recursive: true, force: true });
  if (scratchSeedsDir) fs.rmSync(scratchSeedsDir, { recursive: true, force: true });
});

describe('unit-of-measure normalization migration', () => {
  it('normalizes known variants and registers unknown labels without losing them', async () => {
    const services = await db('service_catalog').where({ tenant }).select('unit_of_measure', 'unit_code');
    const codeByLabel = new Map(services.map((row: { unit_of_measure: string; unit_code: string }) => [row.unit_of_measure, row.unit_code]));
    expect(codeByLabel.get('EA')).toBe('C62');
    expect(codeByLabel.get(' each ')).toBe('C62');
    expect(codeByLabel.get('Hrs')).toBe('HUR');
    expect(codeByLabel.get('GB')).toBe('E34');
    expect(codeByLabel.get('Widgets')).toBe('C62');
    const configs = await db('contract_line_service_usage_config').where({ tenant }).select('unit_of_measure', 'unit_code');
    expect(configs).toEqual(expect.arrayContaining([
      expect.objectContaining({ unit_of_measure: 'EA', unit_code: 'C62' }),
      expect.objectContaining({ unit_of_measure: 'Hrs', unit_code: 'HUR' }),
    ]));
    expect(codeByLabel.get('Seats')).toBe('C62');
    expect(await db('tenant_units_of_measure').where({ tenant, label: 'Widgets', code: 'C62' }).first()).toBeTruthy();
    // Vocabulary labels are not duplicated as tenant custom units.
    expect(await db('tenant_units_of_measure').where({ tenant, label: 'Seats' }).first()).toBeUndefined();
    const registered = await registerTenantUnit(db, tenant, 'Action registration unit');
    expect(registered).toEqual({ code: 'C62', label: 'Action registration unit' });
    expect(await registerTenantUnit(db, tenant, ' action registration unit ')).toEqual(registered);

    await BACKFILL.down(db);
    await VOCABULARY.down(db);
    await VOCABULARY.up(db);
    await BACKFILL.up(db);
    const rebackfilled = await db('service_catalog').where({ tenant, unit_of_measure: 'Widgets' }).first();
    expect(rebackfilled).toMatchObject({ unit_code: 'C62', unit_of_measure: 'Widgets' });
  }, 30_000);
});
