import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantTableMetadata } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const TENANT_DB_SHIM_PATH = path.resolve(__dirname, '../utils/tenantDb.cjs');
const NEW_TABLES = [
  'contract_line_prepaid_blocks',
  'contract_line_block_issuances',
  'contract_template_line_prepaid_blocks',
  'contract_line_preset_prepaid_blocks',
];

let db: Knex;

async function constraintDef(table: string, name: string): Promise<string | null> {
  const r = await db.raw(
    'SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [name, table],
  );
  return r.rows[0]?.def ?? null;
}

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

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
}, 600_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
});

describe('prepaid block migrations (DB-backed)', () => {
  it('registers every new table in tenant metadata and the migration shim', () => {
    const shim = require(TENANT_DB_SHIM_PATH) as { TENANT_TABLE_METADATA: Record<string, unknown> };
    for (const table of NEW_TABLES) {
      expect(tenantTableMetadata[table as keyof typeof tenantTableMetadata]).toEqual({ scope: 'tenant' });
      expect(shim.TENANT_TABLE_METADATA[table]).toEqual({ scope: 'tenant' });
    }
  });

  it('uses composite tenant primary keys and enforces one scheduled issuance per line', async () => {
    const pks = await db.raw(
      `SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE contype = 'p' AND conrelid = ANY(?::regclass[])`,
      [`{${NEW_TABLES.join(',')}}`],
    );
    const byTable = Object.fromEntries(pks.rows.map((r: any) => [r.tbl, r.def]));
    expect(byTable.contract_line_prepaid_blocks).toBe('PRIMARY KEY (tenant, contract_line_id)');
    expect(byTable.contract_line_block_issuances).toBe('PRIMARY KEY (tenant, issuance_id)');
    expect(byTable.contract_template_line_prepaid_blocks).toBe('PRIMARY KEY (tenant, template_line_id)');
    expect(byTable.contract_line_preset_prepaid_blocks).toBe('PRIMARY KEY (tenant, preset_id)');

    const idx = await db.raw(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'contract_line_block_issuances_one_scheduled_uidx'`,
    );
    expect(idx.rows[0].indexdef).toContain('UNIQUE');
    expect(idx.rows[0].indexdef).toContain("status = 'scheduled'");
  });

  it('rejects invalid block config values with check violations (23514)', async () => {
    const t = randomUUID();
    const l = randomUUID();
    // CHECK constraints are evaluated before the deferred-style FK triggers fire.
    expect(await sqlState(
      `INSERT INTO contract_line_prepaid_blocks (tenant, contract_line_id, block_minutes, block_price)
       VALUES ('${t}', '${l}', 0, 0)`)).toBe('23514');
    expect(await sqlState(
      `INSERT INTO contract_line_prepaid_blocks (tenant, contract_line_id, block_minutes, block_price)
       VALUES ('${t}', '${l}', 60, -1)`)).toBe('23514');
    expect(await sqlState(
      `INSERT INTO contract_line_prepaid_blocks (tenant, contract_line_id, block_minutes, block_price, trigger_threshold_percent)
       VALUES ('${t}', '${l}', 60, 0, 100)`)).toBe('23514');
    expect(await sqlState(
      `INSERT INTO contract_line_prepaid_blocks (tenant, contract_line_id, block_minutes, block_price, expiry_months)
       VALUES ('${t}', '${l}', 60, 0, 121)`)).toBe('23514');
    // trigger_on_expiry requires expiry_months.
    expect(await sqlState(
      `INSERT INTO contract_line_prepaid_blocks (tenant, contract_line_id, block_minutes, block_price, trigger_on_expiry)
       VALUES ('${t}', '${l}', 60, 0, true)`)).toBe('23514');
    // notify is not a valid block-line tier.
    expect(await sqlState(
      `INSERT INTO contract_line_prepaid_blocks (tenant, contract_line_id, block_minutes, block_price, replenishment_tier)
       VALUES ('${t}', '${l}', 60, 0, 'notify')`)).toBe('23514');
    // Valid values pass CHECKs and are stopped only by the FK (23503).
    expect(await sqlState(
      `INSERT INTO contract_line_prepaid_blocks (tenant, contract_line_id, block_minutes, block_price, expiry_months, trigger_on_expiry)
       VALUES ('${t}', '${l}', 60, 0, 12, true)`)).toBe('23503');
  });

  it('widens hour_blocks, audit and alert checks and ties source_type contract to a line', async () => {
    expect(await constraintDef('hour_blocks', 'hour_blocks_source_type_check')).toContain("'contract'");
    expect(await constraintDef('hour_blocks', 'hour_blocks_contract_owner_check')).toContain('contract_line_id IS NOT NULL');
    const audit = (await constraintDef('hour_block_audit', 'hour_block_audit_type_check')) ?? '';
    for (const type of ['contract_end_expiration', 'allocation_release', 'reassignment', 'auto_expiration']) {
      expect(audit).toContain(`'${type}'`);
    }
    expect(await constraintDef('prepaid_balance_alerts', 'prepaid_balance_alerts_alert_type_check')).toContain('prepaid_block');

    const cols = await db('information_schema.columns')
      .whereIn('table_name', ['hour_blocks', 'prepaid_balance_alerts'])
      .whereIn('column_name', ['contract_line_id', 'client_contract_id', 'issuance_id', 'hour_block_id'])
      .select('table_name', 'column_name');
    expect(cols.map((c: any) => `${c.table_name}.${c.column_name}`).sort()).toEqual([
      'hour_blocks.client_contract_id',
      'hour_blocks.contract_line_id',
      'hour_blocks.issuance_id',
      'prepaid_balance_alerts.contract_line_id', // pre-existing (bucket subjects)
      'prepaid_balance_alerts.hour_block_id',
    ]);

    // A 'contract' block without a line, or a line on a non-contract block, is rejected.
    const t = randomUUID();
    const base = `('${t}', '${randomUUID()}', '${randomUUID()}', '${randomUUID()}', 60, 60, 100`;
    expect(await sqlState(
      `INSERT INTO hour_blocks (tenant, block_id, client_id, service_id, total_minutes, remaining_minutes, hourly_rate, source_type)
       VALUES ${base}, 'contract')`)).toBe('23514');
    expect(await sqlState(
      `INSERT INTO hour_blocks (tenant, block_id, client_id, service_id, total_minutes, remaining_minutes, hourly_rate, source_type, contract_line_id)
       VALUES ${base}, 'purchase', '${randomUUID()}')`)).toBe('23514');
  });
});
