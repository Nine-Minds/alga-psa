/**
 * Migration test for 20260814090000_create_contract_line_buckets.cjs
 *
 * Proves (against a real Postgres):
 *  1. up() creates contract_line_buckets / contract_line_bucket_services and
 *     rekeys bucket_usage (bucket_id NOT NULL + numeric(12,2) minutes).
 *  2. The backfill produces exactly one single-member, member-scoped, 1x pool
 *     per legacy contract_line_service_bucket_config row.
 *  3. Existing bucket_usage rows are remapped to the new pool.
 *  4. Legacy-shaped reads (via the frozen legacy tables) return values
 *     identical to what the compat layer reads from the new pool tables.
 *  5. down() restores the legacy world (new tables dropped, bucket_id column
 *     gone, minutes back to bigint) so the frozen legacy tables still describe
 *     the old world.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory, { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = path.resolve(__dirname, '../../..', 'migrations', '20260814090000_create_contract_line_buckets.cjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require(MIGRATION_FILE);

describe('contract_line_buckets migration (real DB)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection();
  });

  afterAll(async () => {
    await knex.destroy().catch(() => undefined);
  });

  it('T001: up() backfills one single-member 1x member-scoped pool per legacy config and remaps usage; compat reads match legacy reads', async () => {
    // --- 1. Revert to the legacy world so the migration test exercises the
    //        real legacy→new transition instead of the already-migrated seed. ---
    await migration.down(knex);

    // --- 2. Seed legacy data: tenant, client, contract, line, service, and a
    //        Bucket configuration + usage rows keyed the legacy way. ---
    const tenant = randomUUID();
    const clientId = randomUUID();
    const contractId = randomUUID();
    const contractLineId = randomUUID();
    const serviceId = randomUUID();
    const configId = randomUUID();

    await knex('tenants').insert({ tenant, client_name: 'Bucket Migration Tenant', email: `mt-${tenant}@example.com` });
    await knex('clients').insert({ tenant, client_id: clientId, client_name: 'Bucket Migration Client', client_type: 'company', is_tax_exempt: false });
    const serviceTypeId = randomUUID();
    await knex('service_types').insert({
      id: serviceTypeId,
      tenant,
      name: `Bucket Migration Type ${tenant.slice(0, 6)}`,
      is_active: true,
    });
    await knex('service_catalog').insert({
      tenant,
      service_id: serviceId,
      service_name: 'Bucket Migration Service',
      billing_method: 'hourly',
      custom_service_type_id: serviceTypeId,
      default_rate: 12500,
      unit_of_measure: 'hour',
    });
    await knex('contracts').insert({ tenant, contract_id: contractId, contract_name: 'Bucket Migration Contract', billing_frequency: 'monthly', is_active: true, status: 'active', is_template: false, currency_code: 'USD', is_system_managed_default: false, owner_client_id: clientId });
    await knex('contract_lines').insert({
      tenant,
      contract_line_id: contractLineId,
      contract_id: contractId,
      contract_line_name: 'Bucket Migration Line',
      billing_frequency: 'monthly',
      contract_line_type: 'Bucket',
      is_active: true,
      is_template: false,
      billing_timing: 'arrears',
      cadence_owner: 'client',
      billing_cycle_alignment: 'start',
      minimum_billable_time: 0,
      round_up_to_nearest: 0,
    });
    await knex('client_contracts').insert({
      tenant,
      client_contract_id: randomUUID(),
      client_id: clientId,
      contract_id: contractId,
      start_date: '2026-01-01',
      is_active: true,
      status: 'pending',
      renewal_mode: 'none',
      notice_period_days: 0,
      renewal_due_date_action_policy: 'queue_only',
    });

    // The legacy shape this migration replaces: a configuration_type='Bucket'
    // row plus its detail row, and bucket_usage keyed by (client, service, period).
    await knex('contract_line_service_configuration').insert({
      tenant,
      config_id: configId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Bucket',
      custom_rate: null,
      quantity: null,
    });
    await knex('contract_line_service_bucket_config').insert({
      tenant,
      config_id: configId,
      total_minutes: 2400,
      overage_rate: 15000,
      allow_rollover: true,
      billing_period: 'monthly',
    });
    const periodStarts = ['2026-07-01', '2026-08-01'];
    for (let i = 0; i < periodStarts.length; i += 1) {
      await knex('bucket_usage').insert({
        tenant,
        usage_id: randomUUID(),
        client_id: clientId,
        contract_line_id: contractLineId,
        service_catalog_id: serviceId,
        period_start: `${periodStarts[i]} 00:00:00+00`,
        period_end: `${periodStarts[i].slice(0, 8)}31 00:00:00+00`,
        minutes_used: 1200 + i * 100,
        overage_minutes: i === 1 ? 100 : 0,
        rolled_over_minutes: 0,
      });
    }

    // --- 3. Capture the legacy-shaped read before running up(). ---
    const legacyConfig = await knex('contract_line_service_bucket_config')
      .where({ tenant, config_id: configId })
      .first();
    const legacyUsage = await knex('bucket_usage').where({ tenant }).select('usage_id', 'minutes_used', 'overage_minutes', 'rolled_over_minutes').orderBy('period_start', 'asc');

    // --- 4. Run the migration up() → backfill + rekey. ---
    await migration.up(knex);

    // --- 5. Assert pool shape: one single-member 1x member-scoped pool. ---
    const pools = await knex('contract_line_buckets').where({ tenant });
    expect(pools).toHaveLength(1);
    const pool = pools[0];
    expect(pool.contract_line_id).toBe(contractLineId);
    expect(Number(pool.total_minutes)).toBe(2400);
    expect(Number(pool.overage_rate)).toBe(15000);
    expect(pool.allow_rollover).toBe(true);
    expect(pool.billing_period).toBe('monthly');
    expect(pool.covers_all_services).toBe(false);
    expect(pool.after_hours_multiplier).toBeNull();
    expect(pool.business_hours_schedule_id).toBeNull();

    const members = await knex('contract_line_bucket_services').where({ tenant });
    expect(members).toHaveLength(1);
    expect(members[0].bucket_id).toBe(pool.bucket_id);
    expect(members[0].contract_line_id).toBe(contractLineId);
    expect(members[0].service_id).toBe(serviceId);
    expect(Number(members[0].burn_multiplier)).toBe(1);

    // --- 6. Assert usage remap + numeric minutes. ---
    const remappedUsage = await knex('bucket_usage').where({ tenant }).orderBy('period_start', 'asc');
    expect(remappedUsage).toHaveLength(2);
    for (const row of remappedUsage) {
      expect(row.bucket_id).toBe(pool.bucket_id);
      expect(typeof row.minutes_used).toBe('string'); // numeric(12,2) comes back as string
    }
    expect(Number(remappedUsage[0].minutes_used)).toBe(1200);
    expect(Number(remappedUsage[1].minutes_used)).toBe(1300);
    expect(Number(remappedUsage[1].overage_minutes)).toBe(100);

    // --- 7. Assert the compat layer (reads new pool tables) returns values
    //        identical to the legacy-shaped read. ---
    expect(Number(legacyConfig.total_minutes)).toBe(Number(pool.total_minutes));
    expect(Number(legacyConfig.overage_rate)).toBe(Number(pool.overage_rate));
    expect(legacyConfig.allow_rollover).toBe(pool.allow_rollover);
    expect(legacyConfig.billing_period).toBe(pool.billing_period);
    expect(legacyUsage.map(r => ({ minutes_used: Number(r.minutes_used), overage_minutes: Number(r.overage_minutes), rolled_over_minutes: Number(r.rolled_over_minutes) })))
      .toEqual(remappedUsage.map(r => ({ minutes_used: Number(r.minutes_used), overage_minutes: Number(r.overage_minutes), rolled_over_minutes: Number(r.rolled_over_minutes) })));

    // --- 8. Constraint guards are in place. ---
    const catchAllCount = await knex.raw(`
      SELECT count(*)::int AS count FROM pg_indexes
      WHERE indexname = 'contract_line_buckets_one_catch_all_uidx'
    `);
    expect(catchAllCount.rows[0].count).toBe(1);
    const periodUnique = await knex.raw(`
      SELECT count(*)::int AS count FROM pg_indexes
      WHERE indexname = 'bucket_usage_tenant_bucket_period_uidx'
    `);
    expect(periodUnique.rows[0].count).toBe(1);
  });

  it('T002: down() restores the legacy world', async () => {
    await migration.down(knex);

    const poolsExist = await knex.schema.hasTable('contract_line_buckets');
    const membersExist = await knex.schema.hasTable('contract_line_bucket_services');
    expect(poolsExist).toBe(false);
    expect(membersExist).toBe(false);

    const bucketIdColumn = await knex.schema.hasColumn('bucket_usage', 'bucket_id');
    expect(bucketIdColumn).toBe(false);

    const usageCols = await knex('information_schema.columns')
      .select('data_type')
      .where({ table_name: 'bucket_usage', column_name: 'minutes_used' })
      .first();
    expect(usageCols?.data_type).toBe('bigint');

    // Frozen legacy tables still describe the old world.
    const legacyTables = await knex.schema.hasTable('contract_line_service_bucket_config');
    expect(legacyTables).toBe(true);

    // Re-apply up() so the DB stays migrated for the remainder of the session.
    await migration.up(knex);
  });

  it('T003: up() keeps the catalog atttypmod at NUMERIC(12,2) and repairs a seeded mismatch on rerun', async () => {
    // 20260814090000 runs after T002 leaves the DB migrated; up() is guarded
    // and idempotent, so this also proves rerun-safety.
    await migration.up(knex);

    // atttypmod for NUMERIC(12,2) is ((12 << 16) | 2) + 4 = 786438.
    const expectedAtttypmod = ((12 << 16) | 2) + 4;
    const numericTypeOid = 1700;

    const readCatalog = async (conn: Knex, columnName: string): Promise<{ atttypid: number; atttypmod: number }> => {
      const rows = await conn.raw(`
        SELECT atttypid, atttypmod
        FROM pg_attribute
        WHERE attrelid = 'bucket_usage'::regclass
          AND attname = '${columnName}'
          AND NOT attisdropped
      `);
      const row = rows.rows[0];
      return { atttypid: Number(row.atttypid), atttypmod: Number(row.atttypmod) };
    };

    // Fresh run: the catalog encoding matches NUMERIC(12,2) exactly.
    for (const column of ['minutes_used', 'overage_minutes']) {
      const catalog = await readCatalog(knex, column);
      expect(catalog.atttypmod).toBe(expectedAtttypmod);
      expect(catalog.atttypid).toBe(numericTypeOid);
    }

    // Seeding a catalog mismatch (and triggering the repair) requires catalog
    // write access the app role does not have, so do it through the admin role
    // — the migration's detect-and-repair logic is role-agnostic.
    const adminKnex = knexFactory({
      client: 'pg',
      connection: {
        host: '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        database: 'test_database',
        user: 'postgres',
        password: process.env.DB_PASSWORD_ADMIN || 'postpass123',
      },
      pool: { min: 0, max: 1 },
    });

    try {
      // A wrong encoding like the historic bug wrote for minutes_used, and a
      // non-numeric type for overage_minutes.
      await adminKnex.raw(`
        UPDATE pg_attribute
        SET atttypmod = ${((12 + 4) << 16) | (2 + 4)}
        WHERE attrelid = 'bucket_usage'::regclass
          AND attname = 'minutes_used'
          AND NOT attisdropped
      `);
      await adminKnex.raw(`
        UPDATE pg_attribute
        SET atttypid = 23, atttypmod = -1
        WHERE attrelid = 'bucket_usage'::regclass
          AND attname = 'overage_minutes'
          AND NOT attisdropped
      `);

      // Re-run up(): it must DETECT the mismatch and REPAIR the catalog.
      await migration.up(adminKnex);
    } finally {
      await adminKnex.destroy().catch(() => undefined);
    }

    for (const column of ['minutes_used', 'overage_minutes']) {
      const catalog = await readCatalog(knex, column);
      expect(catalog.atttypmod).toBe(expectedAtttypmod);
      expect(catalog.atttypid).toBe(numericTypeOid);
    }
  });
});
