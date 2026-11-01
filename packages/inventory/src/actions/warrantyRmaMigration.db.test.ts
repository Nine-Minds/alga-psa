/**
 * C5 T011 migration cycle (real DB): the warranty migrations run up, down, up on a scratch copy of TEST_DB_NAME
 * (dropped afterwards). This file holds no connection to the source DB, so CREATE DATABASE ... TEMPLATE can succeed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';
import { loadServerMigration } from '../test-utils/serverMigrations';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const MIGRATIONS = [
  '20261029130000_add_warranty_review_to_rma_cases.cjs',
  '20261029130100_backfill_rma_case_warranty_review.cjs',
  '20261029130200_validate_rma_case_constraints.cjs',
  '20261029130300_create_rma_events.cjs',
  '20261029130400_add_warranty_permissions.cjs',
  '20261029130500_upsert_inventory_rma_updated_event_catalog.cjs',
].map((f) => loadServerMigration<{ up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void> }>(f));

const NEW_COLUMNS = [
  'rma_number', 'ticket_id', 'custody_id', 'warranty_decided_by', 'denial_reason', 'closed_reason', 'warranty_outcome',
  'outbound_carrier', 'outbound_tracking_number', 'inbound_carrier', 'inbound_tracking_number', 'return_ship_to',
  'replacement_serial_number', 'warranty_decided_at', 'outbound_shipped_at', 'inbound_received_at',
  'replacement_received_at', 'return_by',
];

async function fkColumns(db: Knex, table: string, constraint: string): Promise<{ cols: string[]; ref: string; refCols: string[] } | null> {
  const r = await db.raw(
    `SELECT (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols,
            c.confrelid::regclass::text AS ref,
            (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS refcols
     FROM pg_constraint c WHERE c.conrelid = ?::regclass AND c.conname = ? AND c.contype = 'f'`,
    [table, constraint]
  );
  const row = r.rows[0];
  return row ? { cols: row.cols, ref: row.ref, refCols: row.refcols } : null;
}

describe('T011 migration cycle on a scratch database (up, down, up)', () => {
  const scratchName = `c5_migration_test`;
  let admin: Knex;
  let scratch: Knex;

  beforeAll(async () => {
    const conn = getInventoryTestDatabaseConnection();
    admin = knexLib({ client: 'pg', connection: { ...conn, database: 'postgres' }, pool: { min: 0, max: 1 } });
    await admin.raw(`DROP DATABASE IF EXISTS ${scratchName}`);
    let lastError: unknown;
    for (let i = 0; i < 10; i++) {
      try {
        await admin.raw(`CREATE DATABASE ${scratchName} TEMPLATE "${conn.database}"`);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (lastError) throw lastError;
    scratch = knexLib({ client: 'pg', connection: { ...conn, database: scratchName }, pool: { min: 1, max: 2 } });
  }, 60_000);
  afterAll(async () => {
    await scratch?.destroy();
    await admin?.raw(`DROP DATABASE IF EXISTS ${scratchName}`);
    await admin?.destroy();
  }, 60_000);

  const up = async () => { for (const m of MIGRATIONS) await m.up(scratch); };
  // 100400 (permissions) is deliberately irreversible per repo policy: its down() throws and is asserted as such.
  const down = async () => {
    await MIGRATIONS[5].down(scratch);
    await expect(MIGRATIONS[4].down(scratch)).rejects.toThrow(/irreversible/);
    await MIGRATIONS[3].down(scratch);
    await MIGRATIONS[2].down(scratch);
    await MIGRATIONS[1].down(scratch);
    await MIGRATIONS[0].down(scratch);
  };
  const columns = async () => new Set((await scratch('information_schema.columns').where({ table_name: 'rma_cases' }).select('column_name')).map((r: any) => r.column_name));

  it('rolls back cleanly, backfills legacy rows on the way up, and re-runs idempotently', async () => {
    expect(await columns()).toContain('rma_number');

    await down();
    const afterDown = await columns();
    for (const c of NEW_COLUMNS) expect(afterDown.has(c), `${c} dropped`).toBe(false);
    expect(await scratch.schema.hasTable('rma_events')).toBe(false);
    const checks = await scratch.raw(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'rma_cases'::regclass AND conname = 'rma_cases_status_check'`);
    expect(checks.rows[0].def).not.toContain('warranty_review');
    expect(checks.rows[0].def).not.toContain('repaired');
    expect(await scratch('next_number').where({ entity_type: 'RMA' }).count('* as c').first()).toMatchObject({ c: '0' });

    // Legacy fixtures: a fresh tenant with three pre-migration cases (open, closed via closed_at, closed via status).
    const t = await createInventoryTestTenant(scratch);
    const legacy = [
      { rma_id: randomUUID(), status: 'open', opened_at: '2026-01-01T00:00:00Z', closed_at: null },
      { rma_id: randomUUID(), status: 'closed', opened_at: '2026-01-02T00:00:00Z', closed_at: '2026-01-03T00:00:00Z' },
      { rma_id: randomUUID(), status: 'closed', opened_at: '2026-01-04T00:00:00Z', closed_at: null },
    ];
    for (const l of legacy) await scratch('rma_cases').insert({ tenant: t, rma_type: 'standard', ...l });
    // and a tenant with no cases at all
    const empty = await createInventoryTestTenant(scratch);

    await up();
    const snapshot = async () =>
      (await scratch('rma_cases').where({ tenant: t }).orderBy('opened_at').select('rma_id', 'rma_number', 'closed_reason', 'status'));
    const first = await snapshot();
    expect(first.map((r: any) => r.rma_number)).toEqual(['RMA-00001', 'RMA-00002', 'RMA-00003']);
    expect(first.map((r: any) => r.closed_reason)).toEqual([null, 'resolved', 'resolved']);

    // every pre-existing case in every tenant got a number; numbers are unique per tenant
    expect(await scratch('rma_cases').whereNull('rma_number').count('* as c').first()).toMatchObject({ c: '0' });
    const dupes = await scratch.raw('SELECT tenant, rma_number FROM rma_cases GROUP BY 1, 2 HAVING count(*) > 1');
    expect(dupes.rows).toHaveLength(0);

    // next_number seed: last_number is the backfilled maximum for that tenant, prefix RMA-, padding 5
    expect(await scratch('next_number').where({ tenant: t, entity_type: 'RMA' }).first()).toMatchObject({ last_number: '3', prefix: 'RMA-', padding_length: 5, initial_value: '1' });
    expect(await scratch('next_number').where({ tenant: empty, entity_type: 'RMA' }).first()).toMatchObject({ last_number: '0', prefix: 'RMA-' });
    const maxPerTenant = await scratch.raw(`SELECT n.tenant, n.last_number, (SELECT COALESCE(MAX(NULLIF(regexp_replace(r.rma_number, '\\D', '', 'g'), '')::bigint), 0) FROM rma_cases r WHERE r.tenant = n.tenant) AS m FROM next_number n WHERE n.entity_type = 'RMA'`);
    for (const r of maxPerTenant.rows) expect(Number(r.last_number), r.tenant).toBeGreaterThanOrEqual(Number(r.m));

    expect(await scratch.schema.hasTable('rma_events')).toBe(true);
    const trg = await scratch.raw(`SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rma_events_immutable'`);
    expect(trg.rows).toHaveLength(1);

    // Second run (idempotent): nothing renumbered, nothing duplicated, no error.
    await up();
    expect(await snapshot()).toEqual(first);
    expect(await scratch('next_number').where({ tenant: t, entity_type: 'RMA' }).first()).toMatchObject({ last_number: '3' });
    expect(await fkColumns(scratch, 'rma_cases', 'rma_cases_ticket_fk')).not.toBeNull();
    expect(await fkColumns(scratch, 'rma_events', 'rma_events_rma_fk')).not.toBeNull();

    // A full second down/up cycle also works with warranty data present.
    await scratch('rma_cases').where({ tenant: t, rma_id: legacy[0].rma_id }).update({ status: 'warranty_review' });
    await down();
    expect((await scratch('rma_cases').where({ tenant: t, rma_id: legacy[0].rma_id }).first()).status).toBe('closed');
    await up();
    expect(await scratch('rma_cases').whereNull('rma_number').count('* as c').first()).toMatchObject({ c: '0' });
  }, 120_000);
});

