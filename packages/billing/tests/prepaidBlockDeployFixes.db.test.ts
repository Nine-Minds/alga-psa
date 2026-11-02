import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';
import { syncPrepaidBlockIssuancesForContractLine } from '../src/services/prepaidBlockIssuanceSync';
import { fetchPrepaidBlockIssuanceDueWorkRows } from '../src/lib/prepaidBlockDueWork';
import { syncRecurringServicePeriodsForContractLine } from '../src/actions/recurringServicePeriodSync';
import { BillingEngine } from '../src/lib/billing/billingEngine';
import { getAvailableRecurringDueWork } from '../src/actions/billingAndTax';

// Deploy-fix round 3 (alga-2026-0002695): behaviour on a server that is NOT on UTC.
// The smoke server runs in America/New_York. Node re-reads TZ when process.env.TZ
// changes, so this file pins the zone itself before any Date is built and restores
// the host zone when it is done; the workspace-db lane (UTC) therefore executes it
// instead of skipping it, which its execution-evidence gate requires.
// Needs HOUR_BLOCK_DB_TESTS=1 (see prepaidBlockInvoicing.db.test.ts for the env vars).
const hostTimeZone = process.env.TZ;
process.env.TZ = 'America/New_York';
afterAll(() => {
  if (hostTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = hostTimeZone;
});
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';
if (enabled && new Date(2026, 9, 13).getTimezoneOffset() === 0) {
  throw new Error('prepaidBlockDeployFixes: TZ=America/New_York did not take effect in this worker');
}

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

let currentDb: Knex;
let currentTenant: string;

vi.mock('@alga-psa/auth', async () => {
  const actual = await vi.importActual<any>('@alga-psa/auth');
  return {
    ...actual,
    withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal' }, { tenant: currentTenant }, ...args),
    getSession: vi.fn(async () => null),
  };
});
vi.mock('@alga-psa/auth/withAuth', async () => {
  const actual = await vi.importActual<any>('@alga-psa/auth/withAuth');
  return {
    ...actual,
    withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal' }, { tenant: currentTenant }, ...args),
  };
});
vi.mock('@alga-psa/auth/rbac', async () => {
  const actual = await vi.importActual<any>('@alga-psa/auth/rbac');
  return { ...actual, hasPermission: vi.fn(async () => true) };
});
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: currentDb, tenant: currentTenant })),
    getConnection: vi.fn(async () => currentDb),
  };
});

interface World {
  db: Knex;
  tenant: string;
  clientId: string;
  serviceId: string;
  contractId: string;
  lineId: string;
  fixedLineId: string;
  clientContractId: string;
  cycleId: string;
  profileId: string;
}

async function setup(opts: { startDate?: string; lineCreatedAt?: string; contractCreatedAt?: string; tenantTimeZone?: string; withFixedLine?: boolean } = {}): Promise<World> {
  const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
  const tenant = uuidv4();
  const clientId = uuidv4();
  const typeId = uuidv4();
  const serviceId = uuidv4();
  const contractId = uuidv4();
  const lineId = uuidv4();
  const fixedLineId = uuidv4();
  const clientContractId = uuidv4();
  const cycleId = uuidv4();
  const profileId = uuidv4();
  currentDb = db;
  currentTenant = tenant;

  await db('tenants').insert({ tenant, client_name: 'PBD Tenant', email: 'pbd@test.local', billing_source: 'test' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBD Client' });
  await db('service_types').insert({ id: typeId, tenant, name: 'PBD Type', is_active: true, order_number: 1 });
  await db('service_catalog').insert({
    service_id: serviceId, tenant, service_name: 'Remote Support', custom_service_type_id: typeId,
    billing_method: 'hourly', default_rate: 11000, unit_of_measure: 'hour',
    category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
  });
  await db('tenant_settings').insert({ tenant, settings: opts.tenantTimeZone ? { timezone: opts.tenantTimeZone } : {} });
  await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'PBD Contract', currency_code: 'EUR', status: 'active',
    // Default: the contract is created together with its line.
    ...((opts.contractCreatedAt ?? opts.lineCreatedAt) ? { created_at: opts.contractCreatedAt ?? opts.lineCreatedAt } : {}),
  });
  await db('client_contracts').insert({
    tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
    start_date: opts.startDate ?? '2026-03-01', is_active: true,
  });
  await db('contract_lines').insert({
    tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'PBD Line', contract_line_type: 'Hourly',
    ...(opts.lineCreatedAt ? { created_at: opts.lineCreatedAt } : {}),
  });
  await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
  if (opts.withFixedLine) {
    await db('contracts').where({ tenant, contract_id: contractId }).update({ owner_client_id: clientId });
    // A ready in-advance Fixed fee sharing the block's contract (and so its invoice window).
    await db('contract_lines').insert({
      tenant, contract_line_id: fixedLineId, contract_id: contractId, contract_line_name: 'PBD Fixed Fee', contract_line_type: 'Fixed',
      billing_timing: 'advance', billing_frequency: 'monthly', created_at: '2026-01-01T00:00:00Z',
    });
    await db('contract_line_services').insert({ tenant, contract_line_id: fixedLineId, service_id: serviceId });
  }
  await db('contract_line_prepaid_blocks').insert({
    tenant, contract_line_id: lineId, block_minutes: 2400, block_price: 440000,
    expiry_months: 12, trigger_on_expiry: true, sold_as_service_id: serviceId,
  });
  await db('client_billing_profiles').insert({
    tenant, billing_profile_id: profileId, client_id: clientId, name: 'PBD Profile', is_default: true,
  });
  await db('client_billing_cycles').insert({
    tenant, billing_profile_id: profileId, billing_cycle_id: cycleId, client_id: clientId, billing_cycle: 'monthly',
    period_start_date: '2026-03-01', period_end_date: '2026-04-01', effective_date: '2026-03-01',
  });
  return { db, tenant, clientId, serviceId, contractId, lineId, fixedLineId, clientContractId, cycleId, profileId };
}

async function teardown(w: World) {
  const { db, tenant } = w;
  for (const table of [
    'hour_block_time_allocations', 'hour_block_audit', 'hour_block_service_scopes', 'hour_blocks',
    'contract_line_block_issuances', 'recurring_service_periods', 'invoice_charges', 'invoices', 'client_billing_cycles', 'time_entries',
    'contract_line_prepaid_blocks', 'contract_line_services', 'tenant_settings', 'client_billing_profiles', 'contract_lines', 'client_contracts',
    'contracts', 'service_catalog', 'service_types', 'clients', 'tenants',
  ]) {
    await db(table).where({ tenant }).delete();
  }
  await db.destroy();
}


const dateOnly = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const issuances = (w: World) => w.db('contract_line_block_issuances').where({ tenant: w.tenant, contract_line_id: w.lineId }).orderBy('due_date');
const sync = (w: World) => w.db.transaction((trx) => syncPrepaidBlockIssuancesForContractLine(trx, w.tenant, w.lineId));
const list = (w: World, asOf: string, to?: string) => fetchPrepaidBlockIssuanceDueWorkRows(w.db, {
  tenant: w.tenant, asOf, ...(to ? { options: { dateRange: { to } } } : {}),
});
async function insertIssuance(w: World, triggerKind: string, dueDate: string) {
  const issuanceId = uuidv4();
  await w.db('contract_line_block_issuances').insert({
    tenant: w.tenant, issuance_id: issuanceId, contract_line_id: w.lineId, client_contract_id: w.clientContractId,
    client_id: w.clientId, trigger_kind: triggerKind, due_date: dueDate, status: 'scheduled',
  });
  return issuanceId;
}
const GUARD_WINDOW = { startDate: '2026-10-01T00:00:00Z', endDate: '2026-11-01T00:00:00Z' };
async function withSystemTime<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  // Only Date is faked: timers and the pg driver keep running on real time.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

describe.runIf(enabled)('Fix 1: date-only handling does not depend on the server zone', () => {
  it('(a) all-arrears client, contract_start issuance, no client-cadence window: lists in the schedule-anchor window', async () => {
    const w = await setup({ startDate: '2026-10-13', lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await w.db('client_billing_cycles').where({ tenant: w.tenant }).delete();
      await sync(w);
      expect(await w.db('recurring_service_periods').where({ tenant: w.tenant }).count({ n: '*' }).first()).toMatchObject({ n: '0' });
      const rows = await list(w, '2026-10-13', '2026-10-13');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        blockTriggerKind: 'contract_start', blockDueDate: '2026-10-13',
        invoiceWindowStart: '2026-10-01', invoiceWindowEnd: '2026-11-01',
        dueState: 'due', isEarly: false, canGenerate: true,
      });
    } finally {
      await teardown(w);
    }
  });

  it('(b) expiry issuance ~12 months out with no materialized window: lands in the schedule-anchor window', async () => {
    const w = await setup({ startDate: '2026-10-13', lineCreatedAt: '2026-01-01T00:00:00Z' });
    try {
      await w.db('client_billing_cycles').where({ tenant: w.tenant }).delete();
      await insertIssuance(w, 'expiry', '2027-10-12');
      // No range end: every scheduled issuance is listed under its window.
      const rows = await list(w, '2026-10-13');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        blockTriggerKind: 'expiry', blockDueDate: '2027-10-12',
        invoiceWindowStart: '2027-10-01', invoiceWindowEnd: '2027-11-01', dueState: 'early', canGenerate: false,
      });
      // With a range end of today the window starts after `to`: skipped, not an error.
      expect(await list(w, '2026-10-13', '2026-10-13')).toHaveLength(0);
    } finally {
      await teardown(w);
    }
  });

  it('one issuance whose window cannot be resolved is logged and skipped, not fatal to the listing', async () => {
    const w = await setup({ startDate: '2026-10-13', lineCreatedAt: '2026-01-01T00:00:00Z' });
    const badClientId = uuidv4();
    const badLineId = uuidv4();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await w.db('client_billing_cycles').where({ tenant: w.tenant }).delete();
      await sync(w);
      // A second client whose billing schedule anchor is unusable.
      await w.db('clients').insert({ tenant: w.tenant, client_id: badClientId, client_name: 'Bad Anchor Client' });
      const badContractId = uuidv4();
      const badClientContractId = uuidv4();
      await w.db('contracts').insert({ tenant: w.tenant, contract_id: badContractId, contract_name: 'Bad Contract', currency_code: 'EUR', status: 'active' });
      await w.db('client_contracts').insert({ tenant: w.tenant, client_contract_id: badClientContractId, client_id: badClientId, contract_id: badContractId, start_date: '2026-10-13', is_active: true });
      await w.db('contract_lines').insert({ tenant: w.tenant, contract_line_id: badLineId, contract_id: badContractId, contract_line_name: 'Bad Line', contract_line_type: 'Hourly' });
      await w.db('contract_line_prepaid_blocks').insert({
        tenant: w.tenant, contract_line_id: badLineId, block_minutes: 600, block_price: 100, expiry_months: 12, sold_as_service_id: w.serviceId,
      });
      const badIssuanceId = uuidv4();
      await w.db('contract_line_block_issuances').insert({
        tenant: w.tenant, issuance_id: badIssuanceId, contract_line_id: badLineId, client_contract_id: badClientContractId,
        client_id: badClientId, trigger_kind: 'contract_start', due_date: '2026-10-13', status: 'scheduled',
      });
      // Bad anchor data: a weekly schedule whose reference instant is not UTC midnight.
      await w.db('clients').where({ tenant: w.tenant, client_id: badClientId }).update({ billing_cycle: 'bi-weekly' });
      await w.db('client_billing_settings').insert({
        tenant: w.tenant, client_id: badClientId, zero_dollar_invoice_handling: 'normal', suppress_zero_dollar_invoices: false,
        billing_cycle_anchor_reference_date: '2026-10-13T05:30:00Z',
      });

      const rows = await list(w, '2026-10-13', '2026-10-13');
      expect(rows.map((r) => r.clientId)).toEqual([w.clientId]);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(badIssuanceId), expect.anything());
    } finally {
      errorSpy.mockRestore();
      await w.db('contract_line_block_issuances').where({ tenant: w.tenant, contract_line_id: badLineId }).delete();
      await w.db('contract_line_prepaid_blocks').where({ tenant: w.tenant, contract_line_id: badLineId }).delete();
      await w.db('contract_lines').where({ tenant: w.tenant, contract_line_id: badLineId }).delete();
      await w.db('client_contracts').where({ tenant: w.tenant, client_id: badClientId }).delete();
      await w.db('contracts').where({ tenant: w.tenant, contract_name: 'Bad Contract' }).delete();
      await w.db('client_billing_settings').where({ tenant: w.tenant, client_id: badClientId }).delete();
      await w.db('clients').where({ tenant: w.tenant, client_id: badClientId }).delete();
      await teardown(w);
    }
  });
});

describe.runIf(enabled)('Fix 2: one business date for first-due, listing readiness and the server guard', () => {
  it('a line created in the US evening (next UTC day) on its contract start date is due on the start date', async () => {
    // 2026-10-14T00:00Z is 20:00 EDT on 10/13.
    const w = await setup({ startDate: '2026-10-13', lineCreatedAt: '2026-10-14T00:00:00Z', tenantTimeZone: 'America/New_York' });
    try {
      expect(await sync(w)).toMatchObject({ action: 'scheduled', dueDate: '2026-10-13' });
      expect(dateOnly((await issuances(w))[0].due_date)).toBe('2026-10-13');
    } finally {
      await teardown(w);
    }
  });

  it('the block is Ready on the start date (asOf = local today), not early / Blocked', async () => {
    const w = await setup({ startDate: '2026-10-13', lineCreatedAt: '2026-10-14T00:00:00Z', tenantTimeZone: 'America/New_York' });
    try {
      await w.db('client_billing_cycles').where({ tenant: w.tenant }).delete();
      await sync(w);
      const rows = await list(w, '2026-10-13', '2026-10-13');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ blockDueDate: '2026-10-13', dueState: 'due', isEarly: false, canGenerate: true });
    } finally {
      await teardown(w);
    }
  });

  it('a line added mid-contract is due on the date it was added, on the business-date basis', async () => {
    // Contract started 2026-09-01; line added 2026-10-14T02:30Z = 22:30 EDT on 10/13.
    const w = await setup({ startDate: '2026-09-01', lineCreatedAt: '2026-10-14T02:30:00Z', contractCreatedAt: '2026-08-20T15:00:00Z', tenantTimeZone: 'America/New_York' });
    try {
      expect(await sync(w)).toMatchObject({ action: 'scheduled', dueDate: '2026-10-13' });
    } finally {
      await teardown(w);
    }
  });

  it('the server guard accepts generation on the contract start date, and refuses the day before', async () => {
    const w = await setup({ startDate: '2026-10-13', lineCreatedAt: '2026-10-14T00:00:00Z', tenantTimeZone: 'America/New_York' });
    try {
      await sync(w);
      const issuanceId = (await issuances(w))[0].issuance_id;
      const engine = BillingEngine.forTransaction(w.db as any, w.tenant) as any;
      // 20:30 EDT on 10/13 (already 10/14 in UTC): the start date is today.
      const charges = await withSystemTime('2026-10-14T00:30:00Z', () => engine.loadPrepaidBlockIssuanceCharges(w.clientId, GUARD_WINDOW, [issuanceId]));
      expect(charges).toHaveLength(1);
      // 23:00 EDT on 10/12 (already 10/13 in UTC): not yet the start date.
      await expect(
        withSystemTime('2026-10-13T03:00:00Z', () => engine.loadPrepaidBlockIssuanceCharges(w.clientId, GUARD_WINDOW, [issuanceId])),
      ).rejects.toThrow(/not due until 2026-10-13/);
    } finally {
      await teardown(w);
    }
  });

  describe('tenant timezone UNSET (UTC fallback), host TZ America/New_York', () => {
    // 2026-10-14T00:30Z is 20:30 EDT on 10/13.
    const EVENING = '2026-10-14T00:30:00Z';

    it('(a) contract and line created at 20:30 EDT on the start date: due on the start date', async () => {
      const w = await setup({ startDate: '2026-10-13', lineCreatedAt: EVENING, contractCreatedAt: '2026-10-14T00:29:00Z' });
      try {
        expect(await sync(w)).toMatchObject({ action: 'scheduled', dueDate: '2026-10-13' });
        expect(dateOnly((await issuances(w))[0].due_date)).toBe('2026-10-13');
      } finally {
        await teardown(w);
      }
    });

    it('(a2) a stored contract_start row shifted by UTC is re-synced to the start date', async () => {
      const w = await setup({ startDate: '2026-10-13', lineCreatedAt: EVENING, contractCreatedAt: '2026-10-14T00:29:00Z' });
      try {
        await insertIssuance(w, 'contract_start', '2026-10-14');
        expect(await sync(w)).toMatchObject({ action: 'rescheduled', dueDate: '2026-10-13' });
        expect(dateOnly((await issuances(w))[0].due_date)).toBe('2026-10-13');
      } finally {
        await teardown(w);
      }
    });

    it('(b) a line added days after the contract started: due on the business date it was added', async () => {
      // Added 2026-10-12T14:00Z (10:00 EDT on 10/12), contract started 10/05.
      const w = await setup({ startDate: '2026-10-05', lineCreatedAt: '2026-10-12T14:00:00Z', contractCreatedAt: '2026-10-01T12:00:00Z' });
      try {
        expect(await sync(w)).toMatchObject({ action: 'scheduled', dueDate: '2026-10-12' });
      } finally {
        await teardown(w);
      }
    });

    it('(c) the server guard accepts generation of (a) on the start date', async () => {
      const w = await setup({ startDate: '2026-10-13', lineCreatedAt: EVENING, contractCreatedAt: '2026-10-14T00:29:00Z' });
      try {
        await sync(w);
        const issuanceId = (await issuances(w))[0].issuance_id;
        const engine = BillingEngine.forTransaction(w.db as any, w.tenant) as any;
        // Unset timezone resolves to UTC: at 20:30 EDT on 10/13 the business date is 10/14 (>= start date).
        const charges = await withSystemTime(EVENING, () => engine.loadPrepaidBlockIssuanceCharges(w.clientId, GUARD_WINDOW, [issuanceId]));
        expect(charges).toHaveLength(1);
      } finally {
        await teardown(w);
      }
    });
  });
});

// The first getAvailableRecurringDueWork call loads a large module graph; allow for a cold start.
describe.runIf(enabled)('Fix 3: an early Prepaid Block member does not block the ready members of its window', { timeout: 60_000 }, () => {
  async function dueWorkCandidates(w: World, to: string) {
    const result: any = await getAvailableRecurringDueWork({ dateRange: { to } } as any);
    return (result.invoiceCandidates ?? []) as any[];
  }

  it('mixed window: the ready in-advance Fixed fee is generatable, the early block reads as not yet due on its own candidate', async () => {
    const w = await setup({ startDate: '2026-10-01', lineCreatedAt: '2026-01-01T00:00:00Z', tenantTimeZone: 'America/New_York', withFixedLine: true });
    try {
      await w.db.transaction((trx) => syncRecurringServicePeriodsForContractLine(trx, {
        tenant: w.tenant, contractLineId: w.fixedLineId, sourceRunPrefix: 'pbd-fix3',
      }));
      await insertIssuance(w, 'expiry', '2026-10-28');
      const candidates = await withSystemTime('2026-10-13T16:00:00Z', () => dueWorkCandidates(w, '2026-10-13'));
      const blockCandidate = candidates.find((c) => c.members.some((m: any) => m.chargeType === 'PrepaidBlock'));
      const fixedCandidate = candidates.find((c) => c.members.some((m: any) => m.chargeType === 'Fixed'));
      expect(blockCandidate).toBeDefined();
      expect(fixedCandidate).toBeDefined();
      expect(fixedCandidate).not.toBe(blockCandidate);
      expect(fixedCandidate.members.every((m: any) => m.chargeType !== 'PrepaidBlock')).toBe(true);
      expect(fixedCandidate).toMatchObject({ canGenerate: true, notYetDue: false, blockedReason: null });
      expect(blockCandidate.members).toHaveLength(1);
      expect(blockCandidate).toMatchObject({ canGenerate: false, notYetDue: true, availableOnDate: '2026-10-28' });
      expect(blockCandidate.candidateKey).not.toBe(fixedCandidate.candidateKey);
    } finally {
      await teardown(w);
    }
  });

  // Plan D8: a cadence block's price is known before generation.
  async function insertCadenceBlockPeriod(w: World, enableProration: boolean) {
    await w.db('contracts').where({ tenant: w.tenant, contract_id: w.contractId }).update({ owner_client_id: w.clientId });
    await w.db('client_billing_cycles').insert({
      tenant: w.tenant, billing_profile_id: w.profileId, billing_cycle_id: uuidv4(), client_id: w.clientId, billing_cycle: 'monthly',
      period_start_date: '2026-10-01', period_end_date: '2026-11-01', effective_date: '2026-10-01',
    });
    await w.db('contract_lines').where({ tenant: w.tenant, contract_line_id: w.lineId }).update({
      billing_frequency: 'monthly', billing_timing: 'arrears', cadence_owner: 'client', enable_proration: enableProration,
    });
    await w.db('contract_line_prepaid_blocks').where({ tenant: w.tenant, contract_line_id: w.lineId })
      .update({ issue_mode: 'cadence', block_minutes: 600, block_price: 150000, expiry_months: null, trigger_on_expiry: false, trigger_on_exhaustion: false, trigger_threshold_percent: null, trigger_on_renewal: false });
    await w.db('recurring_service_periods').insert({
      tenant: w.tenant,
      schedule_key: `schedule:${w.tenant}:${w.lineId}:client:advance:prepaid_block`,
      period_key: 'period:2026-10-01:2026-11-01',
      revision: 1,
      obligation_id: w.lineId,
      charge_family: 'prepaid_block',
      cadence_owner: 'client',
      due_position: 'advance',
      lifecycle_state: 'generated',
      service_period_start: '2026-10-01',
      service_period_end: '2026-11-01',
      invoice_window_start: '2026-10-01',
      invoice_window_end: '2026-11-01',
      provenance_kind: 'generated',
      source_rule_version: '1.0.0',
    });
  }

  it.each([
    ['proration off', false, 150000],
    ['proration on, assignment covers the whole period', true, 150000],
  ])('cadence block member carries its block price as amountCents (%s)', async (_label, proration, expected) => {
    const w = await setup({ startDate: '2026-03-01', lineCreatedAt: '2026-01-01T00:00:00Z', tenantTimeZone: 'America/New_York' });
    try {
      await insertCadenceBlockPeriod(w, proration);
      const candidates = await withSystemTime('2026-10-13T16:00:00Z', () => dueWorkCandidates(w, '2026-10-13'));
      const member = candidates.flatMap((c) => c.members).find((m: any) => m.chargeType === 'PrepaidBlock');
      expect(member).toBeDefined();
      expect(member.amountCents).toBe(expected);
    } finally {
      await teardown(w);
    }
  });

  it('a proration-enabled cadence block starting mid-period stays pending (coverage ratio < 1)', async () => {
    const w = await setup({ startDate: '2026-10-15', lineCreatedAt: '2026-01-01T00:00:00Z', tenantTimeZone: 'America/New_York' });
    try {
      await insertCadenceBlockPeriod(w, true);
      const candidates = await withSystemTime('2026-10-20T16:00:00Z', () => dueWorkCandidates(w, '2026-10-20'));
      const member = candidates.flatMap((c) => c.members).find((m: any) => m.chargeType === 'PrepaidBlock');
      expect(member).toBeDefined();
      expect(member.amountCents ?? null).toBeNull();
    } finally {
      await teardown(w);
    }
  });

  it('a window holding only an early block is still notYetDue with availableOnDate (the block\'s due date)', async () => {
    const w = await setup({ startDate: '2026-10-01', lineCreatedAt: '2026-01-01T00:00:00Z', tenantTimeZone: 'America/New_York' });
    try {
      await insertIssuance(w, 'expiry', '2026-10-28');
      const candidates = await withSystemTime('2026-10-13T16:00:00Z', () => dueWorkCandidates(w, '2026-10-13'));
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({ canGenerate: false, notYetDue: true, availableOnDate: '2026-10-28', blockedReason: null });
    } finally {
      await teardown(w);
    }
  });
});
