import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { isPeriodAlreadyInvoiced } from '../../../packages/billing/src/lib/billing/pricing/isPeriodAlreadyInvoiced';
import { canonicalizeRecurringServicePeriodScheduleKey } from '../../../shared/billingClients/recurringServicePeriodKeys';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const TARGET_MIGRATION = '20261010120000_collapse_recurring_service_period_obligation_type.cjs';
const MIGRATIONS_DIR = path.resolve(__dirname, '..');
const MIGRATION = require(path.join(MIGRATIONS_DIR, TARGET_MIGRATION));
const SCRATCH_DB = 'test_db_collapse_obligation_type_migration';
const TABLE = 'recurring_service_periods';

const canonical = (tenant: string, obligationId: string, cadenceOwner: string, duePosition = 'arrears') =>
  MIGRATION.computeCanonicalScheduleKey({ tenant, obligationId, cadenceOwner, duePosition });
const legacy = (tenant: string, label: string, obligationId: string, cadenceOwner: string, duePosition = 'arrears') =>
  `schedule:${tenant}:${label}:${obligationId}:${cadenceOwner}:${duePosition}`;

describe('planCollisionGroup (pure)', () => {
  const base = {
    periodKey: 'p', revision: 1, cadenceOwner: 'client', duePosition: 'arrears', invoiceId: null,
    supersedesRecordId: null, reasonCode: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  };
  it('prefers the linked lineage and renumbers the winner live row last', () => {
    const rows = [
      { ...base, recordId: 'a', scheduleKey: 'old-client', lifecycleState: 'generated' },
      { ...base, recordId: 'b', scheduleKey: 'old-contract', lifecycleState: 'billed', invoiceId: 'inv' },
    ];
    const plan = MIGRATION.planCollisionGroup(rows, 'client');
    expect(plan.winnerScheduleKey).toBe('old-contract');
    const byId = Object.fromEntries(plan.rows.map((r: any) => [r.recordId, r]));
    expect(byId.b.revision).toBe(2);
    expect(byId.a.revision).toBe(1);
    expect(byId.a.lifecycleState).toBe('superseded');
    expect(byId.a.reasonCode).toBe('obligation_label_collapse');
    expect(plan.retainedLoserRecordIds).toEqual([]);
  });
  it('is deterministic regardless of input order', () => {
    const rows = [
      { ...base, recordId: 'a', scheduleKey: 'k1', lifecycleState: 'generated' },
      { ...base, recordId: 'b', scheduleKey: 'k2', lifecycleState: 'generated' },
    ];
    expect(MIGRATION.planCollisionGroup(rows, 'client')).toEqual(MIGRATION.planCollisionGroup([...rows].reverse(), 'client'));
  });
  it('retains both billed rows and reports them', () => {
    const rows = [
      { ...base, recordId: 'a', scheduleKey: 'k1', lifecycleState: 'billed', invoiceId: 'i1' },
      { ...base, recordId: 'b', scheduleKey: 'k2', lifecycleState: 'billed', invoiceId: 'i2' },
    ];
    const plan = MIGRATION.planCollisionGroup(rows, 'client');
    expect(plan.rows.every((r: any) => r.lifecycleState === 'billed')).toBe(true);
    expect(new Set(plan.rows.map((r: any) => r.revision)).size).toBe(2);
    expect(plan.retainedLoserRecordIds).toHaveLength(1);
  });
  it('computes canonical and legacy keys', () => {
    expect(canonical('t', 'o', 'client')).toBe('schedule:t:o:client:arrears');
    expect(MIGRATION.computeLegacyScheduleKey({ tenant: 't', obligationId: 'o', cadenceOwner: 'contract', duePosition: 'advance' }))
      .toBe('schedule:t:contract_line:o:contract:advance');
  });
});

describe('collapse recurring_service_periods.obligation_type migration', () => {
  let db: Knex;
  let preDir: string;
  const tenant = randomUUID();
  const ids = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, randomUUID()]));
  const rec = Object.fromEntries(
    ['a', 'b', 'c', 'dGen', 'dLinked', 'eOne', 'eTwo', 'fOld1', 'fOld2', 'fLive'].map((k) => [k, randomUUID()]),
  );

  const insertRow = (o: Record<string, unknown>) => db(TABLE).insert({
    tenant, revision: 1, charge_family: 'fixed', cadence_owner: 'client', due_position: 'arrears',
    lifecycle_state: 'generated', service_period_start: '2026-08-01', service_period_end: '2026-09-01',
    invoice_window_start: '2026-09-01', invoice_window_end: '2026-10-01', provenance_kind: 'generated',
    source_rule_version: 'v', period_key: '2026-08-01:2026-09-01', ...o,
  });
  const linked = () => ({
    invoice_id: randomUUID(), invoice_charge_id: randomUUID(), invoice_charge_detail_id: randomUUID(),
    invoice_linked_at: new Date(), lifecycle_state: 'billed',
  });

  beforeAll(async () => {
    wireLocalTestDbEnv();
    preDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collapse-obligation-pre-'));
    for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n < TARGET_MIGRATION && n.endsWith('.cjs'))) {
      fs.writeFileSync(path.join(preDir, file), `module.exports = require(${JSON.stringify(path.join(MIGRATIONS_DIR, file))});\n`);
    }
    db = await createTestDbConnection({ databaseName: SCRATCH_DB, migrationsDir: preDir, runSeeds: false });
    fs.writeFileSync(path.join(preDir, TARGET_MIGRATION), `module.exports = require(${JSON.stringify(path.join(MIGRATIONS_DIR, TARGET_MIGRATION))});\n`);

    await db('tenants').insert({ tenant, client_name: 'Collapse', email: 'collapse@example.com', created_at: db.fn.now(), updated_at: db.fn.now() });

    // (a) client cadence, canonical label
    await insertRow({ record_id: rec.a, obligation_id: ids.a, obligation_type: 'client_contract_line',
      schedule_key: legacy(tenant, 'client_contract_line', ids.a, 'client'), source_run_key: `run:${legacy(tenant, 'client_contract_line', ids.a, 'client')}` });
    // (b) contract cadence, canonical label
    await insertRow({ record_id: rec.b, obligation_id: ids.b, obligation_type: 'contract_line', cadence_owner: 'contract',
      schedule_key: legacy(tenant, 'contract_line', ids.b, 'contract') });
    // (c) non-canonical label for the cadence
    await insertRow({ record_id: rec.c, obligation_id: ids.c, obligation_type: 'contract_line',
      schedule_key: legacy(tenant, 'contract_line', ids.c, 'client') });
    // (d) collision: unlinked canonical-label row vs linked non-canonical row
    await insertRow({ record_id: rec.dGen, obligation_id: ids.d, obligation_type: 'client_contract_line',
      schedule_key: legacy(tenant, 'client_contract_line', ids.d, 'client') });
    await insertRow({ record_id: rec.dLinked, obligation_id: ids.d, obligation_type: 'contract_line',
      schedule_key: legacy(tenant, 'contract_line', ids.d, 'client'), ...linked() });
    // (e) collision: both billed and linked
    await insertRow({ record_id: rec.eOne, obligation_id: ids.e, obligation_type: 'client_contract_line',
      schedule_key: legacy(tenant, 'client_contract_line', ids.e, 'client'), ...linked() });
    await insertRow({ record_id: rec.eTwo, obligation_id: ids.e, obligation_type: 'contract_line',
      schedule_key: legacy(tenant, 'contract_line', ids.e, 'client'), ...linked() });
    // (f) superseded history on one lineage plus a live row on the other
    await insertRow({ record_id: rec.fOld1, obligation_id: ids.f, obligation_type: 'client_contract_line', revision: 1, lifecycle_state: 'superseded',
      schedule_key: legacy(tenant, 'client_contract_line', ids.f, 'client') });
    await insertRow({ record_id: rec.fOld2, obligation_id: ids.f, obligation_type: 'client_contract_line', revision: 2, lifecycle_state: 'superseded',
      schedule_key: legacy(tenant, 'client_contract_line', ids.f, 'client') });
    await insertRow({ record_id: rec.fLive, obligation_id: ids.f, obligation_type: 'contract_line', revision: 1,
      schedule_key: legacy(tenant, 'contract_line', ids.f, 'client') });

    const result = await db.migrate.up({ directory: preDir, name: TARGET_MIGRATION });
    expect(result[1]).toContain(TARGET_MIGRATION);
  }, 300_000);

  afterAll(async () => {
    if (db) {
      await db(TABLE).where({ tenant }).del().catch(() => undefined);
      await db('tenants').where({ tenant }).del().catch(() => undefined);
      await db.destroy().catch(() => undefined);
    }
    if (preDir) fs.rmSync(preDir, { recursive: true, force: true });
  });

  const get = (recordId: string) => db(TABLE).where({ tenant, record_id: recordId }).first();

  it('drops the column and its check constraint', async () => {
    expect(await db.schema.hasColumn(TABLE, 'obligation_type')).toBe(false);
    const check = await db.raw(`SELECT 1 FROM pg_constraint WHERE conname = 'recurring_service_periods_obligation_type_check'`);
    expect(check.rows).toHaveLength(0);
  });

  it('(a)(b)(c) rewrites every key to the canonical shape', async () => {
    expect((await get(rec.a)).schedule_key).toBe(canonical(tenant, ids.a, 'client'));
    expect((await get(rec.a)).source_run_key).toBe(`run:${canonical(tenant, ids.a, 'client')}`);
    expect((await get(rec.b)).schedule_key).toBe(canonical(tenant, ids.b, 'contract'));
    expect((await get(rec.c)).schedule_key).toBe(canonical(tenant, ids.c, 'client'));
  });

  it('(d) the linked row wins with the highest revision and the loser is superseded', async () => {
    const winner = await get(rec.dLinked);
    const loser = await get(rec.dGen);
    expect(winner.lifecycle_state).toBe('billed');
    expect(winner.invoice_id).toBeTruthy();
    expect(loser.lifecycle_state).toBe('superseded');
    expect(loser.reason_code).toBe('obligation_label_collapse');
    expect(winner.revision).toBeGreaterThan(loser.revision);
    expect(winner.schedule_key).toBe(loser.schedule_key);
  });

  it('regression: a legacy-labelled key resolves to the single winning record, which is already invoiced', async () => {
    const legacyKey = legacy(tenant, 'contract_line', ids.d, 'client');
    const resolved = canonicalizeRecurringServicePeriodScheduleKey(legacyKey);
    const rows = await db(TABLE).where({ tenant, schedule_key: resolved, period_key: '2026-08-01:2026-09-01' }).whereNot({ lifecycle_state: 'superseded' });
    expect(rows).toHaveLength(1);
    expect(rows[0].record_id).toBe(rec.dLinked);
    expect(rows[0].invoice_charge_detail_id).toBeTruthy();
    expect(await isPeriodAlreadyInvoiced(db, tenant, ids.d, { start: '2026-08-01', end: '2026-09-01' })).toBe(true);
    // the unique ledger key forbids a second live record for the same period
    await expect(insertRow({ record_id: randomUUID(), obligation_id: ids.d, schedule_key: resolved, revision: rows[0].revision })).rejects.toThrow();
  });

  it('(e) two billed rows are both retained with distinct revisions', async () => {
    const one = await get(rec.eOne);
    const two = await get(rec.eTwo);
    expect(one.lifecycle_state).toBe('billed');
    expect(two.lifecycle_state).toBe('billed');
    expect(one.schedule_key).toBe(two.schedule_key);
    expect(one.revision).not.toBe(two.revision);
  });

  it('(f) renumbers revisions contiguously with a single live row', async () => {
    const rows = await db(TABLE).where({ tenant, obligation_id: ids.f }).orderBy('revision');
    expect(rows.map((r: any) => r.revision)).toEqual([1, 2, 3]);
    expect(rows.filter((r: any) => r.lifecycle_state !== 'superseded')).toHaveLength(1);
    expect(rows[2].record_id).toBe(rec.fLive);
  });

  it('keeps the unique schedule/period/revision constraint', async () => {
    const c = await db.raw(`SELECT 1 FROM pg_constraint WHERE conname = 'recurring_service_periods_tenant_schedule_period_revision_uidx'
      UNION ALL SELECT 1 FROM pg_indexes WHERE indexname = 'recurring_service_periods_tenant_schedule_period_revision_uidx'`);
    expect(c.rows.length).toBeGreaterThan(0);
  });

  it('a second up is a no-op', async () => {
    const before = await db(TABLE).where({ tenant }).orderBy('record_id');
    await MIGRATION.up(db);
    const after = await db(TABLE).where({ tenant }).orderBy('record_id');
    expect(after).toEqual(before);
    const summary = await MIGRATION.collapseTenant(db, tenant, { log: () => undefined });
    expect(summary.rewritten).toBe(0);
  });

  it('down restores the legacy keys and column, then up converges again', async () => {
    const before = await db(TABLE).where({ tenant }).orderBy('record_id');
    await db.migrate.down({ directory: preDir, name: TARGET_MIGRATION });
    expect(await db.schema.hasColumn(TABLE, 'obligation_type')).toBe(true);
    expect((await get(rec.a)).schedule_key).toBe(legacy(tenant, 'client_contract_line', ids.a, 'client'));
    expect((await get(rec.a)).obligation_type).toBe('client_contract_line');
    expect((await get(rec.b)).schedule_key).toBe(legacy(tenant, 'contract_line', ids.b, 'contract'));
    expect((await get(rec.b)).obligation_type).toBe('contract_line');

    await db.migrate.up({ directory: preDir, name: TARGET_MIGRATION });
    const after = await db(TABLE).where({ tenant }).orderBy('record_id');
    const strip = (rows: any[]) => rows.map(({ updated_at, ...r }) => r);
    expect(strip(after)).toEqual(strip(before));
  });
});
