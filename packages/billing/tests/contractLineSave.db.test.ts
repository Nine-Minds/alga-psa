import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';
import {
  getContractLineEditVersion,
  saveContractLineEdit,
  type ContractLineEditDraft,
} from '../src/actions/contractLineSaveAction';
import { isContractLineConflict } from '../src/lib/billing/contractLineConflict';
import { ContractLineServiceConfigurationService } from '../src/services/contractLineServiceConfigurationService';
import { syncRecurringServicePeriodsForContractLine } from '../src/actions/recurringServicePeriodSync';

// Guarded DB test (real schema) for the single-transaction Contract Lines save
// (alga-2026-0002714). Enable with CONTRACT_LINE_SAVE_DB_TESTS=1. Connection
// defaults match the local dev stack; override with CONTRACT_LINE_SAVE_DB_*.

const enabled = process.env.CONTRACT_LINE_SAVE_DB_TESTS === '1';

const config = {
  host: process.env.CONTRACT_LINE_SAVE_DB_HOST || '127.0.0.1',
  port: Number(process.env.CONTRACT_LINE_SAVE_DB_PORT || 6472),
  user: process.env.CONTRACT_LINE_SAVE_DB_USER || 'app_user',
  password: process.env.CONTRACT_LINE_SAVE_DB_PASSWORD || '',
  database: process.env.CONTRACT_LINE_SAVE_DB_NAME || 'server',
};

let db: Knex;
let tenant: string;
let userId: string;
let typeOrder = 0;
let runWithTenantCtxBase: <T>(t: string, fn: () => Promise<T>) => Promise<T>;
let runWithTenantCtx: <T>(fn: () => Promise<T>) => Promise<T>;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => runWithTenantCtx(() => fn({ user_id: userId }, { tenant }, ...args)),
  getSession: vi.fn(async () => ({ user: { id: userId } })),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: db })) };
});
vi.mock('../src/lib/authHelpers', () => ({
  getAnalyticsAsync: async () => ({
    analytics: { capture: vi.fn() },
    AnalyticsEvents: { BILLING_RULE_UPDATED: 'billing_rule_updated' },
  }),
}));
vi.mock('../src/actions/recurringServicePeriodSync', () => ({
  syncRecurringServicePeriodsForContractLine: vi.fn(async () => undefined),
}));
vi.mock('../src/services/prepaidBlockIssuanceSync', () => ({
  syncPrepaidBlockIssuancesForContractLine: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
}));

const syncSpy = vi.mocked(syncRecurringServicePeriodsForContractLine);

const SNAPSHOT_TABLES = [
  'contract_lines',
  'contract_line_services',
  'contract_line_service_configuration',
  'contract_line_service_fixed_config',
  'contract_line_service_hourly_configs',
  'contract_line_buckets',
  'contract_line_bucket_services',
  'contract_line_unit_pricing_revisions',
  'contract_line_unit_pricing_revision_history',
] as const;

interface Seed {
  lineId: string;
  fixedServiceId: string;
  fixedConfigId: string;
  hourlyServiceId: string;
  hourlyConfigId: string;
  newServiceId: string;
}

describe.runIf(enabled)('saveContractLineEdit: one transaction per edit', () => {
  let seed: Seed;

  beforeAll(async () => {
    ({ runWithTenant: runWithTenantCtxBase } = await import('@alga-psa/db') as any);
    runWithTenantCtx = (fn) => runWithTenantCtxBase(tenant, fn);
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 3 } });
    tenant = uuidv4();
    userId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'CL Save Tenant', email: 'clsave@test.local', billing_source: 'test' });
  });

  afterAll(async () => {
    await cleanupTenantRows();
    await db('tenants').where({ tenant }).delete();
    await db.destroy();
  });

  async function cleanupTenantRows() {
    for (const table of [
      'contract_line_unit_pricing_revision_history',
      'contract_line_unit_pricing_revisions',
      'contract_line_bucket_services',
      'contract_line_buckets',
      'contract_line_service_hourly_configs',
      'contract_line_service_fixed_config',
      'contract_line_service_configuration',
      'contract_line_services',
      'contract_lines',
      'contracts',
      'service_catalog',
      'service_types',
      'clients',
    ]) {
      await db(table).where({ tenant }).delete();
    }
  }

  async function seedService(name: string, method: 'fixed' | 'hourly'): Promise<string> {
    const typeId = uuidv4();
    const serviceId = uuidv4();
    await db('service_types').insert({ id: typeId, tenant, name: `${name} type`, is_active: true, order_number: ++typeOrder });
    await db('service_catalog').insert({
      service_id: serviceId, tenant, service_name: name, custom_service_type_id: typeId,
      billing_method: method, default_rate: 10000, unit_of_measure: method === 'hourly' ? 'hour' : 'each',
      category_id: null, tax_rate_id: null, item_kind: 'service', is_active: true, is_license: false,
    });
    return serviceId;
  }

  beforeEach(async () => {
    await cleanupTenantRows();
    syncSpy.mockClear();
    typeOrder = 0;
    const clientId = uuidv4();
    const contractId = uuidv4();
    const lineId = uuidv4();
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'CL Save Client' });
    await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'CL Save Contract', owner_client_id: clientId });
    await db('contract_lines').insert({
      tenant, contract_line_id: lineId, contract_line_name: 'CL Save Line', contract_id: contractId,
      contract_line_type: 'Fixed', billing_frequency: 'monthly', billing_timing: 'arrears',
      cadence_owner: 'client', is_active: true,
    });
    const fixedServiceId = await seedService('Fixed Svc', 'fixed');
    const hourlyServiceId = await seedService('Hourly Svc', 'hourly');
    const newServiceId = await seedService('New Svc', 'fixed');
    const svc = new ContractLineServiceConfigurationService(db, tenant);
    for (const serviceId of [fixedServiceId, hourlyServiceId]) {
      await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
    }
    const [fixedConfigId, hourlyConfigId] = await runWithTenantCtx(async () => [
    await svc.createConfiguration(
      { tenant, contract_line_id: lineId, service_id: fixedServiceId, configuration_type: 'Fixed', quantity: 2 } as any,
      { base_rate: 1000, base_rate_basis: 'per_unit' } as any,
    ),
    await svc.createConfiguration(
      { tenant, contract_line_id: lineId, service_id: hourlyServiceId, configuration_type: 'Hourly', quantity: 1 } as any,
      { hourly_rate: 9000 } as any,
    )]);
    // A shared two-member pool: overlaying either member is refused (step 5 failure).
    const bucketId = uuidv4();
    await db('contract_line_buckets').insert({
      tenant, bucket_id: bucketId, contract_line_id: lineId, bucket_name: null, total_minutes: 600,
      overage_rate: 100, allow_rollover: false, billing_period: 'monthly', after_hours_multiplier: null,
      business_hours_schedule_id: null, covers_all_services: false,
    });
    for (const serviceId of [fixedServiceId, hourlyServiceId]) {
      await db('contract_line_bucket_services').insert({
        tenant, bucket_id: bucketId, service_id: serviceId, contract_line_id: lineId, burn_multiplier: 1,
      });
    }
    seed = { lineId, fixedServiceId, fixedConfigId, hourlyServiceId, hourlyConfigId, newServiceId };
  });

  async function snapshot(): Promise<string> {
    const out: Record<string, unknown[]> = {};
    for (const table of SNAPSHOT_TABLES) {
      const rows = await db(table).where({ tenant }).select('*');
      out[table] = rows.map((r) => JSON.stringify(r)).sort();
    }
    return JSON.stringify(out);
  }

  async function version(): Promise<string> {
    const v = await getContractLineEditVersion(seed.lineId);
    expect(typeof v).toBe('string');
    return v as string;
  }

  const draft = (v: string, over: Partial<ContractLineEditDraft> = {}): ContractLineEditDraft => ({
    line: {},
    members: [],
    removed_config_ids: [],
    added_service_ids: [],
    removed_service_ids: [],
    bucket_overlays: [],
    effective_boundary: null,
    expected_version: v,
    ...over,
  });

  it('a failing bucket overlay after earlier writes leaves every table exactly as it was', async () => {
    const before = await snapshot();
    const result = await saveContractLineEdit(seed.lineId, draft(await version(), {
      line: { billing_timing: 'advance' },
      members: [
        { config_id: seed.fixedConfigId, service_id: seed.fixedServiceId, quantity: 7 },
        { service_id: seed.newServiceId, configuration_type: 'Fixed', quantity: 1, base_rate: 2500 },
      ],
      added_service_ids: [seed.newServiceId],
      // Hourly Svc is a member of a shared pool: refused at the overlay step, after the other writes.
      bucket_overlays: [{ service_id: seed.hourlyServiceId, overlay: { total_minutes: 60, overage_rate: 5 } }],
    }));
    expect((result as any).status).not.toBe('saved');
    expect(result).toHaveProperty('actionError');
    expect(await snapshot()).toBe(before);
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('an invalid rate is refused before any write and changes nothing', async () => {
    const before = await snapshot();
    const result = await saveContractLineEdit(seed.lineId, draft(await version(), {
      line: { billing_timing: 'advance' },
      members: [
        { config_id: seed.fixedConfigId, service_id: seed.fixedServiceId, quantity: 7 },
        { config_id: seed.hourlyConfigId, service_id: seed.hourlyServiceId, hourly_rate: -5 },
      ],
    }));
    expect(result).toHaveProperty('actionError');
    expect(await snapshot()).toBe(before);
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('a combined edit commits atomically and rematerializes service periods once', async () => {
    const v0 = await version();
    // Free the hourly service from the shared pool so its overlay is allowed.
    await db('contract_line_bucket_services').where({ tenant, service_id: seed.hourlyServiceId }).delete();
    const v1 = await version();
    const result = await saveContractLineEdit(seed.lineId, draft(v1, {
      line: { billing_timing: 'advance' },
      members: [
        { config_id: seed.fixedConfigId, service_id: seed.fixedServiceId, quantity: 5, base_rate: 1500 },
        { service_id: seed.newServiceId, configuration_type: 'Fixed', quantity: 3, base_rate: 2500 },
      ],
      added_service_ids: [seed.newServiceId],
      bucket_overlays: [{ service_id: seed.hourlyServiceId, overlay: { total_minutes: 120, overage_rate: 7500, billing_period: 'monthly' } }],
    }));
    expect(result).toMatchObject({ status: 'saved', rematerialized: true });
    expect(v0).not.toBe((result as any).version);

    expect((await db('contract_lines').where({ tenant, contract_line_id: seed.lineId }).first()).billing_timing).toBe('advance');
    expect(Number((await db('contract_line_service_configuration').where({ tenant, config_id: seed.fixedConfigId }).first()).quantity)).toBe(5);
    const fixed = await db('contract_line_service_fixed_config').where({ tenant, config_id: seed.fixedConfigId }).first();
    expect([Number(fixed.base_rate), fixed.base_rate_basis]).toEqual([1500, 'per_unit']);
    const added = await db('contract_line_service_configuration').where({ tenant, contract_line_id: seed.lineId, service_id: seed.newServiceId }).first();
    expect(Number(added.quantity)).toBe(3);
    const addedFixed = await db('contract_line_service_fixed_config').where({ tenant, config_id: added.config_id }).first();
    expect([Number(addedFixed.base_rate), addedFixed.base_rate_basis]).toEqual([2500, 'per_unit']);
    const poolMember = await db('contract_line_bucket_services').where({ tenant, service_id: seed.hourlyServiceId }).first();
    const pool = await db('contract_line_buckets').where({ tenant, bucket_id: poolMember.bucket_id }).first();
    expect([pool.total_minutes, Number(pool.overage_rate)]).toEqual([120, 7500]);

    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it('a pricing-only edit succeeds without rematerializing', async () => {
    const result = await saveContractLineEdit(seed.lineId, draft(await version(), {
      members: [{ config_id: seed.fixedConfigId, service_id: seed.fixedServiceId, quantity: 4 }],
    }));
    expect(result).toMatchObject({ status: 'saved', rematerialized: false });
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('a stale version token is rejected as a conflict and writes nothing', async () => {
    const stale = await version();
    const first = await saveContractLineEdit(seed.lineId, draft(stale, {
      members: [{ config_id: seed.fixedConfigId, service_id: seed.fixedServiceId, quantity: 4 }],
    }));
    expect(first).toMatchObject({ status: 'saved' });
    expect((first as any).version).not.toBe(stale);
    const after = await snapshot();
    syncSpy.mockClear();

    const second = await saveContractLineEdit(seed.lineId, draft(stale, {
      line: { billing_timing: 'advance' },
      members: [{ config_id: seed.fixedConfigId, service_id: seed.fixedServiceId, quantity: 9 }],
    }));
    expect(isContractLineConflict(second)).toBe(true);
    expect(await snapshot()).toBe(after);
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('a later member update that throws rolls back the line, the earlier member and everything else', async () => {
    const before = await snapshot();
    const original = ContractLineServiceConfigurationService.prototype.updateConfiguration;
    let calls = 0;
    const spy = vi.spyOn(ContractLineServiceConfigurationService.prototype, 'updateConfiguration')
      .mockImplementation(async function (this: ContractLineServiceConfigurationService, ...args: any[]) {
        calls += 1;
        if (calls === 2) throw new Error('Configuration with ID later-member not found');
        return (original as any).apply(this, args);
      });
    try {
      const result = await saveContractLineEdit(seed.lineId, draft(await version(), {
        line: { billing_timing: 'advance' },
        members: [
          { config_id: seed.fixedConfigId, service_id: seed.fixedServiceId, quantity: 6 },
          { config_id: seed.hourlyConfigId, service_id: seed.hourlyServiceId, hourly_rate: 8000 },
        ],
      }));
      expect(calls).toBe(2); // the first member really was written before the second failed
      expect(result).toHaveProperty('actionError');
    } finally {
      spy.mockRestore();
    }
    expect(await snapshot()).toBe(before);
    expect(syncSpy).not.toHaveBeenCalled();
  });

  describe('a revision already scheduled at the boundary', () => {
    const BOUNDARY = '2027-01-01';
    async function seedScheduledRevision() {
      await db('contract_line_service_fixed_config').where({ tenant, config_id: seed.fixedConfigId })
        .update({ pricing_basis: 'unit' });
      await db('contract_line_unit_pricing_revisions').insert({
        tenant, contract_line_id: seed.lineId, service_id: seed.fixedServiceId, config_id: seed.fixedConfigId,
        quantity: 9, unit_rate_cents: 1700, effective_period_start: BOUNDARY, price_policy: 'override', version: 3,
      });
    }
    const revisionRows = () => db('contract_line_unit_pricing_revisions').where({ tenant }).select('*');

    it('is left untouched by a description-only edit that re-sends the displayed values', async () => {
      await seedScheduledRevision();
      const beforeRows = await revisionRows();
      const result = await saveContractLineEdit(seed.lineId, draft(await version(), {
        line: { invoice_line_description: 'Support and monitoring' },
        // Exactly what the editor shows at the boundary: the scheduled values.
        members: [
          { config_id: seed.fixedConfigId, service_id: seed.fixedServiceId, quantity: 9, custom_rate: null, base_rate: 1700 },
          { config_id: seed.hourlyConfigId, service_id: seed.hourlyServiceId, quantity: 1, custom_rate: null, hourly_rate: 9000 },
        ],
        effective_boundary: BOUNDARY,
      }));
      expect(result).toMatchObject({ status: 'saved', rematerialized: false });
      const afterRows = await revisionRows();
      expect(afterRows).toHaveLength(1);
      expect(afterRows[0]).toEqual(beforeRows[0]); // same row, same version, same updated_at
      expect(Number(afterRows[0].version)).toBe(3);
      expect(await db('contract_line_unit_pricing_revision_history').where({ tenant }).count('* as n').first())
        .toMatchObject({ n: '0' });
      expect((await db('contract_lines').where({ tenant, contract_line_id: seed.lineId }).first()).invoice_line_description)
        .toBe('Support and monitoring');
    });

    it('is replaced (compare-and-set on its version) when the user changed that member', async () => {
      await seedScheduledRevision();
      const result = await saveContractLineEdit(seed.lineId, draft(await version(), {
        members: [{ config_id: seed.fixedConfigId, service_id: seed.fixedServiceId, quantity: 12, custom_rate: null, base_rate: 1700 }],
        effective_boundary: BOUNDARY,
      }));
      expect(result).toMatchObject({ status: 'saved' });
      const rows = await revisionRows();
      expect(rows).toHaveLength(1);
      expect([rows[0].quantity, Number(rows[0].version)]).toEqual([12, 4]);
    });
  });
});
