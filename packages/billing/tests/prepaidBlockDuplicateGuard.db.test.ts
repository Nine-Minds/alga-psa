import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';

// Guarded DB test for the already-billed guards around a cadence Prepaid Block fee: a claimed
// `prepaid_block` recurring_service_periods row is seen by the engine's duplicate guard
// (hasExistingServicePeriodCharge), while the rollout preview's isPeriodAlreadyInvoiced signal 1
// excludes that stream, so the line's own (fixed) stream stays independent. Run with
// HOUR_BLOCK_DB_TESTS=1 and the HOUR_BLOCK_DB_* env; skipped by default.

const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

let db: Knex;
const tenant = uuidv4();

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: db, tenant })) };
});

const PERIOD_START = '2026-03-01';
const PERIOD_END = '2026-04-01';

async function insertPeriod(lineId: string, chargeFamily: string, overrides: Record<string, unknown> = {}) {
  await db('recurring_service_periods').insert({
    tenant,
    schedule_key: `sched-${uuidv4()}`,
    period_key: `${PERIOD_START}:${PERIOD_END}`,
    obligation_id: lineId,
    charge_family: chargeFamily,
    cadence_owner: 'client',
    due_position: 'advance',
    lifecycle_state: 'billed',
    service_period_start: PERIOD_START,
    service_period_end: PERIOD_END,
    invoice_window_start: PERIOD_START,
    invoice_window_end: PERIOD_END,
    provenance_kind: 'generated',
    source_rule_version: 'test',
    invoice_id: uuidv4(),
    invoice_linked_at: new Date(),
    ...overrides,
  });
}

describe.runIf(enabled)('prepaid_block duplicate guard', () => {
  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    await db('tenants').insert({ tenant, client_name: 'Guard Tenant', email: 'guard@test.local', billing_source: 'test' });
  });
  afterAll(async () => {
    await db('recurring_service_periods').where({ tenant }).delete();
    await db('tenants').where({ tenant }).delete();
    await db.destroy();
  });

  it('sees a claimed prepaid_block period and keeps the line stream independent', async () => {
    const { BillingEngine } = await import('../src/lib/billing/billingEngine');
    const { isPeriodAlreadyInvoiced } = await import('../src/lib/billing/pricing/isPeriodAlreadyInvoiced');
    const engine: any = new BillingEngine();
    Object.assign(engine, { knex: db, tenant });
    const guard = (lineId: string, timing: 'advance' | 'arrears' = 'advance', start = PERIOD_START, end = '2026-03-31') =>
      engine.hasExistingServicePeriodCharge(lineId, start, end, timing) as Promise<boolean>;
    const window = { start: PERIOD_START, end: PERIOD_END };

    const lineId = uuidv4();
    const otherLineId = uuidv4();
    expect(await guard(lineId)).toBe(false);

    await insertPeriod(lineId, 'prepaid_block');

    // The engine guard sees the claimed block fee (inclusive or exclusive period end), for that line,
    // timing and start only.
    expect(await guard(lineId)).toBe(true);
    expect(await guard(lineId, 'advance', PERIOD_START, PERIOD_END)).toBe(true);
    expect(await guard(lineId, 'arrears')).toBe(false);
    expect(await guard(lineId, 'advance', '2026-04-01', '2026-04-30')).toBe(false);
    expect(await guard(otherLineId)).toBe(false);

    // The rollout preview does not treat the block stream as the line being invoiced.
    expect(await isPeriodAlreadyInvoiced(db, tenant, lineId, window)).toBe(false);

    // A line-stream row for the same line and window is what flips the preview signal.
    await insertPeriod(lineId, 'fixed');
    expect(await isPeriodAlreadyInvoiced(db, tenant, lineId, window)).toBe(true);
    expect(await isPeriodAlreadyInvoiced(db, tenant, otherLineId, window)).toBe(false);

    // An unclaimed (not yet invoiced) block period is not a duplicate.
    const freshLineId = uuidv4();
    await insertPeriod(freshLineId, 'prepaid_block', {
      lifecycle_state: 'generated', invoice_id: null, invoice_linked_at: null,
    });
    expect(await guard(freshLineId)).toBe(false);
  });
});
