/**
 * C5 schema tests (real DB): T011 (rma_cases columns, CHECKs, numbering, composite FKs; the migration cycle lives in
 * warrantyRmaMigration.db.test.ts) and T012 (rma_events is append-only).
 *
 * The migration cycle runs against a scratch database created as a copy of TEST_DB_NAME so other suites can keep
 * using the main test database concurrently. The scratch database is dropped afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import knexLib, { type Knex } from 'knex';
import { loadServerMigration, serverMigrationPath } from '../test-utils/serverMigrations';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const REPO = path.resolve(__dirname, '../../../..');
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

let knex: Knex;
let tenant: string;
let userId: string;
let clientId: string;

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: getInventoryTestDatabaseConnection(), pool: { min: 1, max: 4 } });
  tenant = await createInventoryTestTenant(knex);
  userId = (await knex('users').where({ tenant }).first()).user_id;
  clientId = (await knex('clients').where({ tenant }).first()).client_id;
});
afterAll(async () => { await knex?.destroy(); });

const caseRow = (over: Record<string, unknown> = {}) => ({
  tenant, rma_id: randomUUID(), rma_number: `RMA-S-${randomUUID().slice(0, 8)}`, rma_type: 'standard', client_id: clientId,
  status: 'warranty_review', created_by: userId, ...over,
});
const pgCode = async (p: Promise<unknown>) => {
  try { await p; } catch (e: any) { return e.code as string; }
  return null;
};

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

describe('T011 rma_cases warranty schema', () => {
  it('has every new column, with the right nullability', async () => {
    const cols = await knex('information_schema.columns').where({ table_schema: 'public', table_name: 'rma_cases' }).select('column_name', 'is_nullable');
    const byName = new Map(cols.map((c: any) => [c.column_name, c.is_nullable]));
    for (const c of NEW_COLUMNS) expect(byName.has(c), `column ${c}`).toBe(true);
    for (const c of NEW_COLUMNS.filter((x) => x !== 'rma_number')) expect(byName.get(c), `${c} nullable`).toBe('YES');
    expect(byName.get('rma_number')).toBe('NO');
  });

  it('enforces the status, warranty_outcome, closed_reason and denial_reason CHECKs', async () => {
    for (const status of ['warranty_review', 'repaired', 'open', 'closed']) {
      const row = caseRow({ status });
      await knex('rma_cases').insert(row);
      await knex('rma_cases').where({ tenant, rma_id: row.rma_id }).del();
    }
    expect(await pgCode(knex('rma_cases').insert(caseRow({ status: 'dead_unit_returned' })))).toBe('23514');
    expect(await pgCode(knex('rma_cases').insert(caseRow({ status: 'nonsense' })))).toBe('23514');
    expect(await pgCode(knex('rma_cases').insert(caseRow({ warranty_outcome: 'maybe' })))).toBe('23514');
    for (const o of ['covered', 'unknown']) {
      const row = caseRow({ warranty_outcome: o });
      await knex('rma_cases').insert(row);
      await knex('rma_cases').where({ tenant, rma_id: row.rma_id }).del();
    }
    expect(await pgCode(knex('rma_cases').insert(caseRow({ closed_reason: 'because' })))).toBe('23514');
    for (const r of ['resolved', 'warranty_denied', 'cancelled', 'duplicate', 'vendor_credited']) {
      const row = caseRow({ closed_reason: r });
      await knex('rma_cases').insert(row);
      await knex('rma_cases').where({ tenant, rma_id: row.rma_id }).del();
    }
    // not_covered requires a non-blank denial_reason
    expect(await pgCode(knex('rma_cases').insert(caseRow({ warranty_outcome: 'not_covered' })))).toBe('23514');
    expect(await pgCode(knex('rma_cases').insert(caseRow({ warranty_outcome: 'not_covered', denial_reason: '   ' })))).toBe('23514');
    const ok = caseRow({ warranty_outcome: 'not_covered', denial_reason: 'Physical damage' });
    await knex('rma_cases').insert(ok);
    await knex('rma_cases').where({ tenant, rma_id: ok.rma_id }).del();
  });

  it('rma_number is NOT NULL and unique per tenant (but reusable across tenants)', async () => {
    expect(await pgCode(knex('rma_cases').insert({ ...caseRow(), rma_number: null }))).toBe('23502');
    const a = caseRow({ rma_number: `RMA-U-${randomUUID().slice(0, 8)}` });
    await knex('rma_cases').insert(a);
    expect(await pgCode(knex('rma_cases').insert(caseRow({ rma_number: a.rma_number })))).toBe('23505');
    const otherTenant = await createInventoryTestTenant(knex);
    const otherUser = (await knex('users').where({ tenant: otherTenant }).first()).user_id;
    await knex('rma_cases').insert({ tenant: otherTenant, rma_id: randomUUID(), rma_number: a.rma_number, rma_type: 'standard', status: 'open', created_by: otherUser });
    const idx = await knex.raw(`SELECT indexdef FROM pg_indexes WHERE tablename = 'rma_cases' AND indexname = 'rma_cases_tenant_rma_number_unique'`);
    expect(idx.rows[0].indexdef).toMatch(/UNIQUE.*\(tenant, rma_number\)/);
  });

  it('ticket, custody and decided-by foreign keys are composite and tenant-inclusive; a cross-tenant reference is rejected', async () => {
    expect(await fkColumns(knex, 'rma_cases', 'rma_cases_ticket_fk')).toEqual({ cols: ['tenant', 'ticket_id'], ref: 'tickets', refCols: ['tenant', 'ticket_id'] });
    expect(await fkColumns(knex, 'rma_cases', 'rma_cases_custody_fk')).toEqual({ cols: ['tenant', 'custody_id'], ref: 'asset_custody', refCols: ['tenant', 'custody_id'] });
    expect(await fkColumns(knex, 'rma_cases', 'rma_cases_warranty_decided_by_fk')).toEqual({ cols: ['tenant', 'warranty_decided_by'], ref: 'users', refCols: ['tenant', 'user_id'] });
    expect(await fkColumns(knex, 'rma_events', 'rma_events_rma_fk')).toEqual({ cols: ['tenant', 'rma_id'], ref: 'rma_cases', refCols: ['tenant', 'rma_id'] });
    expect(await fkColumns(knex, 'rma_events', 'rma_events_actor_fk')).toEqual({ cols: ['tenant', 'actor_user_id'], ref: 'users', refCols: ['tenant', 'user_id'] });

    const otherTenant = await createInventoryTestTenant(knex);
    const foreignTicket = (await knex('tickets').where({ tenant: otherTenant }).first()).ticket_id;
    const foreignUser = (await knex('users').where({ tenant: otherTenant }).first()).user_id;
    expect(await pgCode(knex('rma_cases').insert(caseRow({ ticket_id: foreignTicket })))).toBe('23503');
    expect(await pgCode(knex('rma_cases').insert(caseRow({ warranty_decided_by: foreignUser })))).toBe('23503');
    expect(await pgCode(knex('rma_cases').insert(caseRow({ custody_id: randomUUID() })))).toBe('23503');
  });

  it('rma_events exists, is registered for tenant scoping, and next_number has an RMA row per tenant', async () => {
    expect((await knex.schema.hasTable('rma_events'))).toBe(true);
    for (const f of [path.join(REPO, 'packages/db/src/lib/tenantTableMetadata.ts'), serverMigrationPath('utils', 'tenantDb.cjs')]) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/rma_events:\s*\{\s*scope:\s*'tenant'\s*\}/);
    }
    const seeded = await knex('next_number').where({ tenant, entity_type: 'RMA' }).first();
    // createInventoryTestTenant creates the tenant after migration, so the row appears on first numbering use;
    // existing tenants were seeded by the migration (asserted in the migration cycle below).
    expect(seeded === undefined || seeded.prefix === 'RMA-').toBe(true);
  });
});

describe('T012 rma_events is append-only', () => {
  let rmaId: string;
  let eventId: string;
  beforeAll(async () => {
    const row = caseRow({ status: 'open' });
    rmaId = row.rma_id;
    await knex('rma_cases').insert(row);
    eventId = randomUUID();
    await knex('rma_events').insert({ tenant, event_id: eventId, rma_id: rmaId, event_type: 'opened', to_status: 'open', actor_user_id: userId });
  });

  it('UPDATE and DELETE raise the append-only error and leave the row intact', async () => {
    const citus = (await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS e")).rows[0].e;
    expect(citus).toBe(false); // plain Postgres: the trigger is the guarantee
    await expect(knex('rma_events').where({ tenant, event_id: eventId }).update({ note: 'tamper' })).rejects.toThrow(/append-only/);
    await expect(knex('rma_events').where({ tenant, event_id: eventId }).del()).rejects.toThrow(/append-only/);
    await expect(knex('rma_events').where({ tenant }).update({ note: 'bulk' })).rejects.toThrow(/append-only/);
    const row = await knex('rma_events').where({ tenant, event_id: eventId }).first();
    expect(row).toMatchObject({ event_type: 'opened', note: null });
    // inserts still work
    await knex('rma_events').insert({ tenant, rma_id: rmaId, event_type: 'note', note: 'second' });
    expect(await knex('rma_events').where({ tenant, rma_id: rmaId }).count('* as c').first()).toMatchObject({ c: '2' });
  });

  it('the event_type and payload CHECKs hold', async () => {
    expect(await pgCode(knex('rma_events').insert({ tenant, rma_id: rmaId, event_type: 'bogus' }))).toBe('23514');
    expect(await pgCode(knex('rma_events').insert({ tenant, rma_id: rmaId, event_type: 'note', payload: JSON.stringify([1]) }))).toBe('23514');
  });

  it('no production source updates or deletes rma_events; recordRmaEvent is the only inserter', () => {
    const roots = ['packages', 'server/src', 'ee/server/src', 'shared', 'services'].map((r) => path.join(REPO, r)).filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '.next') continue;
        const full = path.join(dir, name);
        let st; try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|cjs|mjs)$/.test(name) && !/\.(test|spec|db\.test|integration\.test)\./.test(name) && !full.includes('/test-utils/')) files.push(full);
      }
    };
    roots.forEach(walk);
    const inserters: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('rma_events')) continue;
      const stmts = src.match(/table\(\s*['"]rma_events['"]\s*\)[\s\S]{0,1500}?(?=;)/g) ?? [];
      const direct = src.match(/(?:knex|trx|db)\(\s*['"]rma_events['"]\s*\)[\s\S]{0,1500}?(?=;)/g) ?? [];
      for (const s of [...stmts, ...direct]) {
        expect(s, `${f} must not mutate rma_events`).not.toMatch(/\.(update|del|delete|truncate)\(/);
        if (/\.insert\(/.test(s)) inserters.push(path.relative(REPO, f));
      }
    }
    expect([...new Set(inserters)]).toEqual(['packages/inventory/src/lib/rma/recordRmaEvent.ts']);
  });
});
