import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import knexFactory, { type Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// Prepaid hours on contracts (alga-2026-0002684): cadence issue mode, hour block
// validity window / period link, prepaid_block charge family.
const require = createRequire(import.meta.url);
const dir = (name: string) => path.resolve(__dirname, '..', name);
const cadenceMode = require(dir('20261028120100_prepaid_block_cadence_mode.cjs'));
const validity = require(dir('20261028120200_hour_blocks_validity_and_period_link.cjs'));
const family = require(dir('20261028120300_recurring_service_periods_prepaid_block_family.cjs'));
const validate = require(dir('20261028120400_validate_prepaid_block_constraints.cjs'));

const CONFIG_TABLES = [
  'contract_line_prepaid_blocks',
  'contract_template_line_prepaid_blocks',
  'contract_line_preset_prepaid_blocks',
];

let db: Knex;
/** Owner connection: the down()/up() round trip is DDL and fabricates rows past FK triggers. */
let admin: Knex;

/** Runs a statement in a rolled-back transaction and returns the SQLSTATE (or 'ok'). */
async function sqlState(sql: string): Promise<string> {
  const trx = await db.transaction();
  try {
    await trx.raw(sql);
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  } finally {
    await trx.rollback().catch(() => undefined);
  }
}

/**
 * Runs `fn` in a transaction that is always rolled back. FK triggers are
 * disabled (replica role) so rows can be fabricated without a full fixture
 * graph; CHECK constraints still apply.
 */
async function inRolledBackTrx(fn: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
  const trx = await admin.transaction();
  try {
    await trx.raw("SET LOCAL session_replication_role = 'replica'");
    await fn(trx);
  } finally {
    await trx.rollback().catch(() => undefined);
  }
}

const tableColumns = async (table: string, columns: string[]) =>
  (await db('information_schema.columns').where({ table_name: table }).whereIn('column_name', columns).select('column_name'))
    .map((c: any) => c.column_name)
    .sort();

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  admin = knexFactory({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: process.env.DB_PASSWORD_ADMIN || 'postpass123',
      database: process.env.TEST_DB_NAME || 'server_test',
    },
    pool: { min: 0, max: 2 },
  });
}, 600_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
  await admin?.destroy().catch(() => undefined);
});

describe('prepaid hours on contracts migrations (DB-backed)', () => {
  it('adds issue_mode / rollover_periods with defaults that leave existing configs on consumption', async () => {
    for (const table of CONFIG_TABLES) {
      const cols = await db('information_schema.columns')
        .where({ table_name: table })
        .whereIn('column_name', ['issue_mode', 'rollover_periods'])
        .select('column_name', 'column_default', 'is_nullable');
      const byName = Object.fromEntries(cols.map((c: any) => [c.column_name, c]));
      expect(byName.issue_mode.is_nullable).toBe('NO');
      expect(byName.issue_mode.column_default).toContain('consumption');
      expect(byName.rollover_periods.is_nullable).toBe('NO');
      expect(String(byName.rollover_periods.column_default)).toBe('0');

      const cadence = await db(table).where('issue_mode', 'cadence').count({ n: '*' }).first();
      expect(Number((cadence as any).n)).toBe(0);
    }
  });

  it('enforces the cadence config CHECKs (23514) and lets valid values reach the FK (23503)', async () => {
    const t = randomUUID();
    const l = randomUUID();
    const insert = (extra: string, values: string) =>
      `INSERT INTO contract_line_prepaid_blocks (tenant, contract_line_id, block_minutes, block_price, ${extra})
       VALUES ('${t}', '${l}', 600, 150000, ${values})`;
    const cadenceOk = 'issue_mode, trigger_on_exhaustion';
    expect(await sqlState(insert('issue_mode', "'weekly'"))).toBe('23514');
    // Cadence mode disables every consumption trigger (trigger_on_exhaustion defaults true).
    expect(await sqlState(insert('issue_mode', "'cadence'"))).toBe('23514');
    expect(await sqlState(insert(`${cadenceOk}, trigger_threshold_percent`, "'cadence', false, 50"))).toBe('23514');
    expect(await sqlState(insert(`${cadenceOk}, trigger_on_renewal`, "'cadence', false, true"))).toBe('23514');
    expect(await sqlState(insert(`${cadenceOk}, expiry_months`, "'cadence', false, 6"))).toBe('23514');
    // Rollover only with cadence, and 0..12.
    expect(await sqlState(insert('rollover_periods', '1'))).toBe('23514');
    expect(await sqlState(insert(`${cadenceOk}, rollover_periods`, "'cadence', false, 13"))).toBe('23514');
    expect(await sqlState(insert(`${cadenceOk}, rollover_periods`, "'cadence', false, -1"))).toBe('23514');
    // Valid cadence configs pass every CHECK and stop at the FK.
    expect(await sqlState(insert(`${cadenceOk}, rollover_periods`, "'cadence', false, 12"))).toBe('23503');
    expect(await sqlState(insert(`${cadenceOk}, rollover_periods`, "'cadence', false, 0"))).toBe('23503');

    for (const table of CONFIG_TABLES.slice(1)) {
      const key = table.includes('template') ? 'template_line_id' : 'preset_id';
      expect(await sqlState(
        `INSERT INTO ${table} (tenant, ${key}, block_minutes, block_price, issue_mode)
         VALUES ('${t}', '${l}', 60, 0, 'cadence')`)).toBe('23514');
    }
  });

  it('adds hour_blocks.valid_from / service_period_record_id as nullable, with the validity and source checks', async () => {
    expect(await tableColumns('hour_blocks', ['valid_from', 'service_period_record_id'])).toEqual([
      'service_period_record_id',
      'valid_from',
    ]);
    const nulls = await db('hour_blocks').whereNotNull('valid_from').orWhereNotNull('service_period_record_id').count({ n: '*' }).first();
    expect(Number((nulls as any).n)).toBe(0);

    const idx = await db.raw("SELECT indexdef FROM pg_indexes WHERE indexname = 'hour_blocks_contract_line_valid_from_idx'");
    expect(idx.rows[0].indexdef).toContain('(tenant, contract_line_id, valid_from)');

    const t = randomUUID();
    const row = (extra: string, values: string) =>
      `INSERT INTO hour_blocks (tenant, block_id, client_id, service_id, total_minutes, remaining_minutes, hourly_rate, ${extra})
       VALUES ('${t}', '${randomUUID()}', '${randomUUID()}', '${randomUUID()}', 60, 60, 100, ${values})`;
    // valid_from must not be after expiration_date.
    expect(await sqlState(row('valid_from, expiration_date', "'2026-12-01', '2026-11-30'"))).toBe('23514');
    // A contract block needs an issuance or a service period record.
    expect(await sqlState(row('source_type, contract_line_id', `'contract', '${randomUUID()}'`))).toBe('23514');
    expect(await sqlState(row(
      'source_type, contract_line_id, service_period_record_id, valid_from, expiration_date',
      `'contract', '${randomUUID()}', '${randomUUID()}', '2026-11-01', '2026-11-30'`,
    ))).toBe('23503'); // passes CHECKs; stopped by the contract-line FK
    // Ad-hoc blocks are unaffected by the new checks (stopped only by the tenant FK).
    expect(await sqlState(row('valid_from', "NULL"))).toBe('23503');
  });

  it('refuses to delete an issuance that has a contract block, but deletes one without blocks', async () => {
    const fk = await db.raw(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'hour_blocks_issuance_fkey'",
    );
    expect(fk.rows[0].def).not.toMatch(/ON DELETE (SET NULL|CASCADE)/);

    await inRolledBackTrx(async (trx) => {
      const tenant = randomUUID();
      const lineId = randomUUID();
      const issuance = (id: string) => ({
        tenant, issuance_id: id, contract_line_id: lineId, client_contract_id: randomUUID(),
      });
      const withBlock = randomUUID();
      const without = randomUUID();
      const base = { client_id: randomUUID(), due_date: '2026-11-01', trigger_kind: 'manual' };
      await trx('contract_line_block_issuances').insert([
        { ...base, ...issuance(withBlock) },
        { ...base, ...issuance(without), contract_line_id: randomUUID() },
      ]);
      await trx('hour_blocks').insert({
        tenant, block_id: randomUUID(), client_id: randomUUID(), service_id: randomUUID(),
        total_minutes: 60, remaining_minutes: 60, hourly_rate: 100,
        source_type: 'contract', contract_line_id: lineId, issuance_id: withBlock,
      });
      await trx.raw("SET LOCAL session_replication_role = 'origin'");
      await trx.raw('SAVEPOINT d1');
      await expect(
        trx('contract_line_block_issuances').where({ tenant, issuance_id: withBlock }).del(),
      ).rejects.toMatchObject({ code: '23503' });
      await trx.raw('ROLLBACK TO SAVEPOINT d1');
      expect(await trx('contract_line_block_issuances').where({ tenant, issuance_id: without }).del()).toBe(1);
    });
  });

  it("allows charge_family = 'prepaid_block' on recurring_service_periods", async () => {
    const def = await db.raw(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'recurring_service_periods_charge_family_check'",
    );
    expect(def.rows[0].def).toContain("'prepaid_block'");
    for (const f of ['fixed', 'product', 'license', 'bucket', 'hourly', 'usage']) {
      expect(def.rows[0].def).toContain(`'${f}'`);
    }
  });

  it('keeps legacy blocks without a source while rejecting new ones, and validates after cleanup', async () => {
    await inRolledBackTrx(async (trx) => {
      // Recreate the pre-migration state with a legacy contract block.
      await trx.raw('ALTER TABLE hour_blocks DROP CONSTRAINT hour_blocks_contract_source_check');
      const orphan = {
        tenant: randomUUID(), block_id: randomUUID(), client_id: randomUUID(), service_id: randomUUID(),
        total_minutes: 60, remaining_minutes: 60, hourly_rate: 100,
        source_type: 'contract', contract_line_id: randomUUID(),
      };
      await trx('hour_blocks').insert(orphan);
      await trx.raw(`ALTER TABLE hour_blocks ADD CONSTRAINT hour_blocks_contract_source_check
        CHECK (source_type <> 'contract' OR issuance_id IS NOT NULL OR service_period_record_id IS NOT NULL) NOT VALID`);

      await validate.up(trx);
      const sourceCheck = () => trx('pg_constraint')
        .where({ conname: 'hour_blocks_contract_source_check' }).first('convalidated');
      expect((await sourceCheck()).convalidated).toBe(false);
      await trx.raw('SAVEPOINT new_orphan');
      await expect(trx('hour_blocks').insert({ ...orphan, block_id: randomUUID() }))
        .rejects.toMatchObject({ code: '23514' });
      await trx.raw('ROLLBACK TO SAVEPOINT new_orphan');

      await trx('hour_blocks').where({ tenant: orphan.tenant, block_id: orphan.block_id }).del();
      await validate.up(trx);
      expect((await sourceCheck()).convalidated).toBe(true);
    });
  });

  it('down() refuses while cadence data exists, succeeds without it, and up() restores everything', async () => {
    await inRolledBackTrx(async (trx) => {
      const tenant = randomUUID();
      const lineId = randomUUID();

      // --- cadence config row blocks migration 1 ---
      await trx('contract_line_prepaid_blocks').insert({
        tenant, contract_line_id: lineId, block_minutes: 600, block_price: 150000,
        issue_mode: 'cadence', trigger_on_exhaustion: false, rollover_periods: 1,
      });
      await trx.raw('SAVEPOINT s1');
      await expect(cadenceMode.down(trx)).rejects.toThrow(/cadence config row/);
      await trx.raw('ROLLBACK TO SAVEPOINT s1');
      await trx('contract_line_prepaid_blocks').where({ tenant }).del();

      // --- cadence block blocks migration 2 ---
      const blockId = randomUUID();
      await trx('hour_blocks').insert({
        tenant, block_id: blockId, client_id: randomUUID(), service_id: randomUUID(),
        total_minutes: 600, remaining_minutes: 600, hourly_rate: 15000,
        source_type: 'contract', contract_line_id: lineId, service_period_record_id: randomUUID(),
        valid_from: '2026-11-01', expiration_date: '2026-11-30',
      });
      await trx.raw('SAVEPOINT s2');
      await expect(validity.down(trx)).rejects.toThrow(/valid_from or service_period_record_id/);
      await trx.raw('ROLLBACK TO SAVEPOINT s2');
      await trx('hour_blocks').where({ tenant, block_id: blockId }).del();

      // --- prepaid_block period blocks migration 3 ---
      const periodId = randomUUID();
      await trx('recurring_service_periods').insert({
        tenant, record_id: periodId, schedule_key: `schedule:${tenant}:${lineId}:client:advance`,
        period_key: 'period:2026-11-01:2026-12-01', obligation_id: lineId, charge_family: 'prepaid_block',
        cadence_owner: 'client', due_position: 'advance',
        service_period_start: '2026-11-01', service_period_end: '2026-12-01',
        invoice_window_start: '2026-11-01', invoice_window_end: '2026-12-01',
        provenance_kind: 'generated', source_rule_version: 'test',
      });
      await trx.raw('SAVEPOINT s3');
      await expect(family.down(trx)).rejects.toThrow(/prepaid_block/);
      await trx.raw('ROLLBACK TO SAVEPOINT s3');
      await trx('recurring_service_periods').where({ tenant, record_id: periodId }).del();
    });

    // Concurrent indexes require the same transaction-free execution as production.
    // Fabricated data above was rolled back; this suite owns its disposable DB.
    try {
      await family.down(admin);
      await validity.down(admin);
      await cadenceMode.down(admin);
      for (const table of CONFIG_TABLES) {
        expect(await admin.schema.hasColumn(table, 'issue_mode')).toBe(false);
        expect(await admin.schema.hasColumn(table, 'rollover_periods')).toBe(false);
      }
      expect(await admin.schema.hasColumn('hour_blocks', 'valid_from')).toBe(false);
      expect(await admin.schema.hasColumn('hour_blocks', 'service_period_record_id')).toBe(false);
      const downDef = await admin.raw(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'recurring_service_periods_charge_family_check'",
      );
      expect(downDef.rows[0].def).not.toContain('prepaid_block');

      await cadenceMode.up(admin);
      await validity.up(admin);
      await family.up(admin);
      const pending = await admin('pg_constraint')
        .whereIn('conname', ['hour_blocks_issuance_fkey', 'hour_blocks_valid_from_expiration_check',
          'hour_blocks_contract_source_check', 'recurring_service_periods_charge_family_check'])
        .select('convalidated');
      expect(pending).toHaveLength(4);
      expect(pending.every((row) => row.convalidated === false)).toBe(true);
      // NOT VALID protects new writes before the separate validation scan.
      expect(await sqlState(`INSERT INTO hour_blocks
        (tenant, block_id, client_id, service_id, total_minutes, remaining_minutes, hourly_rate, valid_from, expiration_date)
        VALUES ('${randomUUID()}', '${randomUUID()}', '${randomUUID()}', '${randomUUID()}', 60, 60, 100, '2026-12-01', '2026-11-30')`))
        .toBe('23514');
      await validate.up(admin);
      const validated = await admin('pg_constraint')
        .whereIn('conname', ['hour_blocks_issuance_fkey', 'hour_blocks_valid_from_expiration_check',
          'hour_blocks_contract_source_check', 'recurring_service_periods_charge_family_check'])
        .select('convalidated');
      expect(validated.every((row) => row.convalidated === true)).toBe(true);
      // up() is idempotent.
      await cadenceMode.up(admin);
      await validity.up(admin);
      await family.up(admin);
      await validate.up(admin);
      await validate.up(admin);
      for (const table of CONFIG_TABLES) {
        expect(await admin.schema.hasColumn(table, 'issue_mode')).toBe(true);
        expect(await admin.schema.hasColumn(table, 'rollover_periods')).toBe(true);
      }
      expect(await admin.schema.hasColumn('hour_blocks', 'valid_from')).toBe(true);
      const upDef = await admin.raw(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'recurring_service_periods_charge_family_check'",
      );
      expect(upDef.rows[0].def).toContain('prepaid_block');
    } finally {
      await cadenceMode.up(admin);
      await validity.up(admin);
      await family.up(admin);
      await validate.up(admin);
    }
  });
});
