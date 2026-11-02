import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import { runWithTenant } from '@alga-psa/db';
import type { Knex } from 'knex';

// Guarded DB tests for the Prepaid Block line config actions (plan section 7):
// upsert/remove validation, Risk 1 warnings, issuance sync, the summary action
// and the bucket-pool guards. Run with HOUR_BLOCK_DB_TESTS=1 (see
// prepaidBlockInvoicing.db.test.ts for the env vars); the DB must carry the
// prepaid block migrations.
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const connection = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};


const hoisted = vi.hoisted(() => {
  const state = { db: null as any, tenant: '' };
  const withAuthMock = (fn: any) => (...args: any[]) => fn({ user_id: 'u1', user_type: 'internal' }, { tenant: state.tenant }, ...args);
  return Object.assign(state, { withAuthMock });
});
const withAuthMock = hoisted.withAuthMock;
vi.mock('@alga-psa/auth', () => ({ withAuth: hoisted.withAuthMock, getSession: vi.fn(async () => null) }));
vi.mock('@alga-psa/auth/withAuth', () => ({ withAuth: hoisted.withAuthMock }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: hoisted.db, tenant: hoisted.tenant })) };
});

const actions = enabled ? await import('../src/actions/prepaidBlockActions') : (null as any);
const presetActions = enabled ? await import('../src/actions/contractLinePresetActions') : (null as any);
const poolActions = enabled ? await import('../src/actions/bucketPoolActions') : (null as any);

const messageOf = (value: any): string => value?.actionError ?? value?.permissionError ?? '';

describe.runIf(enabled)('Prepaid Block line config actions', () => {
  let db: Knex;
  let tenant: string;
  let clientId: string;
  let contractId: string;
  let clientContractId: string;
  let svcA: string;
  let svcB: string;
  let svcUnpriced: string;
  const created = { lines: [] as string[], contracts: [] as string[] };

  async function newLine(opts: { type?: string; services?: string[]; contract?: string; name?: string } = {}) {
    const lineId = uuidv4();
    await db('contract_lines').insert({
      tenant, contract_line_id: lineId, contract_id: opts.contract ?? contractId,
      contract_line_name: opts.name ?? `Line ${lineId.slice(0, 6)}`, contract_line_type: opts.type ?? 'Hourly',
    });
    for (const serviceId of opts.services ?? [svcA]) {
      await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId });
      const configId = uuidv4();
      const rate = serviceId === svcUnpriced ? 0 : serviceId === svcB ? 9000 : 11000;
      await db('contract_line_service_configuration').insert({
        tenant, config_id: configId, contract_line_id: lineId, service_id: serviceId, configuration_type: 'Hourly',
      });
      await db('contract_line_service_hourly_configs').insert({
        tenant, config_id: configId, hourly_rate: rate, minimum_billable_time: 15, round_up_to_nearest: 15,
      });
    }
    created.lines.push(lineId);
    return lineId;
  }

  const validConfig = { block_minutes: 2400, block_price: 440000, expiry_months: 12, trigger_on_expiry: true };

  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection, pool: { min: 0, max: 4 } });
    hoisted.db = db;
    tenant = uuidv4();
    hoisted.tenant = tenant;
    clientId = uuidv4();
    contractId = uuidv4();
    clientContractId = uuidv4();
    svcA = uuidv4(); svcB = uuidv4(); svcUnpriced = uuidv4();
    const typeId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'PBC Tenant', email: 'pbc@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBC Client' });
    await db('service_types').insert({ id: typeId, tenant, name: 'PBC Type', is_active: true, order_number: 1 });
    for (const [id, name] of [[svcA, 'Remote Support'], [svcB, 'Onsite Support'], [svcUnpriced, 'Unpriced Support']] as const) {
      await db('service_catalog').insert({
        service_id: id, tenant, service_name: name, custom_service_type_id: typeId, billing_method: 'hourly',
        default_rate: 11000, unit_of_measure: 'hour', category_id: null, tax_rate_id: null,
        item_kind: 'service', is_active: true, is_license: false,
      });
    }
    await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'PBC Contract', currency_code: 'EUR', status: 'active' });
    created.contracts.push(contractId);
    await db('client_contracts').insert({
      tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId,
      start_date: '2026-03-01', is_active: true,
    });
  });

  afterAll(async () => {
    if (!db) return;
    for (const table of [
      'hour_block_time_allocations', 'hour_block_audit', 'hour_block_service_scopes', 'hour_blocks',
      'contract_line_block_issuances', 'contract_line_prepaid_blocks', 'contract_line_bucket_services', 'contract_line_buckets',
      'contract_line_service_hourly_configs', 'contract_line_service_configuration', 'contract_line_services',
      'contract_lines', 'client_contracts', 'contracts', 'service_catalog', 'service_types', 'clients', 'tenants',
    ]) {
      await db(table).where({ tenant }).delete().catch(() => undefined);
    }
    await db.destroy();
  });

  it('upserts a config, defaults sold_as to the first covered service, and schedules the initial issuance', async () => {
    const lineId = await newLine({ services: [svcA, svcB] });
    const result = await actions.upsertContractLinePrepaidBlock(lineId, validConfig);
    expect(messageOf(result)).toBe('');
    expect(result.config).toMatchObject({ block_minutes: 2400, expiry_months: 12, trigger_on_expiry: true, replenishment_tier: 'draft' });
    expect(Number(result.config.block_price)).toBe(440000);
    expect(result.config.sold_as_service_id).toBe(svcB); // first by service name: "Onsite Support"
    const issuances = await db('contract_line_block_issuances').where({ tenant, contract_line_id: lineId });
    expect(issuances.map((r) => [r.trigger_kind, r.status])).toEqual([['contract_start', 'scheduled']]);
  });

  it('accepts a fractional-hour block (90 minutes) and no expiry', async () => {
    const lineId = await newLine();
    const result = await actions.upsertContractLinePrepaidBlock(lineId, { block_minutes: 90, block_price: 0, expiry_months: null, trigger_on_expiry: false });
    expect(messageOf(result)).toBe('');
    expect(result.config.block_minutes).toBe(90);
    expect(result.config.expiry_months).toBeNull();
  });

  it.each([
    ['block_minutes 0', { block_minutes: 0 }, 'block size'],
    ['negative price', { block_price: -1 }, 'price'],
    ['expiry above 120', { expiry_months: 121 }, 'expiry'],
    ['expiry trigger without expiry', { expiry_months: null, trigger_on_expiry: true }, 'requires an expiry'],
    ['threshold 100', { trigger_threshold_percent: 100 }, 'threshold'],
    ['unknown tier', { replenishment_tier: 'sms' }, 'draft or auto-issued'],
  ])('rejects %s', async (_label, patch, fragment) => {
    const lineId = await newLine();
    const result = await actions.upsertContractLinePrepaidBlock(lineId, { ...validConfig, ...patch });
    expect(messageOf(result)).toContain('Cannot save prepaid block');
    expect(messageOf(result)).toContain(fragment);
    expect(await db('contract_line_prepaid_blocks').where({ tenant, contract_line_id: lineId }).first()).toBeUndefined();
  });

  it('rejects non-Hourly lines, lines with pools, unpriced services and a foreign sold_as service', async () => {
    const fixed = await newLine({ type: 'Fixed' });
    expect(messageOf(await actions.upsertContractLinePrepaidBlock(fixed, validConfig))).toContain('only Hourly');

    const pooled = await newLine();
    await db('contract_line_buckets').insert({ tenant, contract_line_id: pooled, total_minutes: 600, overage_rate: 0, allow_rollover: false, billing_period: 'monthly' });
    expect(messageOf(await actions.upsertContractLinePrepaidBlock(pooled, validConfig))).toContain('bucket pools');

    const unpriced = await newLine({ services: [svcA, svcUnpriced] });
    const unpricedResult = await actions.upsertContractLinePrepaidBlock(unpriced, validConfig);
    expect(messageOf(unpricedResult)).toContain('hourly rate above zero');
    expect(messageOf(unpricedResult)).toContain('Unpriced Support');

    const plain = await newLine();
    expect(messageOf(await actions.upsertContractLinePrepaidBlock(plain, { ...validConfig, sold_as_service_id: svcB }))).toContain('one of the line');
  });

  it('warns (without blocking) when a covered service is also on another active line for the client', async () => {
    const otherContract = uuidv4();
    await db('contracts').insert({ tenant, contract_id: otherContract, contract_name: 'Other', currency_code: 'EUR', status: 'active' });
    created.contracts.push(otherContract);
    await db('client_contracts').insert({ tenant, client_contract_id: uuidv4(), client_id: clientId, contract_id: otherContract, start_date: '2026-01-01', is_active: true });
    const otherLine = await newLine({ contract: otherContract, name: 'Other hourly', services: [svcB] });
    const lineId = await newLine({ services: [svcB] });
    const result = await actions.upsertContractLinePrepaidBlock(lineId, validConfig);
    expect(messageOf(result)).toBe('');
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'covered_service_on_other_active_line', service_id: svcB, service_name: 'Onsite Support',
      other_contract_line_id: otherLine, other_contract_line_name: 'Other hourly',
    })]));
    expect(result.warnings.every((w: any) => w.other_contract_line_id !== lineId)).toBe(true);
  });

  it('removal cancels scheduled issuances and keeps history; refuses while a block holds hours', async () => {
    const lineId = await newLine();
    await actions.upsertContractLinePrepaidBlock(lineId, validConfig);
    expect(await actions.removeContractLinePrepaidBlock(lineId)).toEqual({ removed: true });
    const rows = await db('contract_line_block_issuances').where({ tenant, contract_line_id: lineId });
    expect(rows.map((r) => r.status)).toEqual(['cancelled']);
    expect(await db('contract_line_prepaid_blocks').where({ tenant, contract_line_id: lineId }).first()).toBeUndefined();
    expect(await actions.removeContractLinePrepaidBlock(lineId)).toEqual({ removed: false });

    const busy = await newLine();
    await actions.upsertContractLinePrepaidBlock(busy, validConfig);
    await db('hour_blocks').insert({
      tenant, client_id: clientId, service_id: svcA, total_minutes: 2400, remaining_minutes: 600, hourly_rate: 11000,
      purchase_amount: 440000, currency_code: 'EUR', status: 'active', source_type: 'contract',
      contract_line_id: busy, client_contract_id: clientContractId, service_period_record_id: uuidv4(),
    });
    expect(messageOf(await actions.removeContractLinePrepaidBlock(busy))).toContain('Cannot remove prepaid block configuration');
    expect(await db('contract_line_prepaid_blocks').where({ tenant, contract_line_id: busy }).first()).toBeDefined();
  });

  it('summary reports display kind, currency, balance, pending block age and next issuance', async () => {
    const lineId = await newLine();
    await actions.upsertContractLinePrepaidBlock(lineId, validConfig);
    const plainLine = await newLine();

    const summary = await actions.getContractLinePrepaidBlockSummary(lineId);
    expect(messageOf(summary)).toBe('');
    expect(summary).toMatchObject({
      display_kind: 'PrepaidBlock', currency_code: 'EUR',
      balance: { total_minutes: 0, remaining_minutes: 0, active_block_count: 0 },
      pending_block: null,
    });
    expect(summary.next_issuance).toMatchObject({ trigger_kind: 'contract_start' });
    expect(summary.covered_services[0]).toMatchObject({ service_id: svcA, hourly_rate: 11000 });

    const blockId = uuidv4();
    const base = {
      tenant, client_id: clientId, service_id: svcA, total_minutes: 2400, hourly_rate: 11000,
      purchase_amount: 440000, currency_code: 'EUR', source_type: 'contract', contract_line_id: lineId, client_contract_id: clientContractId,
      service_period_record_id: uuidv4(),
    };
    await db('hour_blocks').insert({
      ...base, block_id: blockId, remaining_minutes: 2400, status: 'pending',
      created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    });
    const withPending = await actions.getContractLinePrepaidBlockSummary(lineId);
    expect(withPending.pending_block).toMatchObject({ block_id: blockId, total_minutes: 2400, invoice_id: null });
    expect(withPending.pending_block.age_days).toBeGreaterThanOrEqual(19);
    expect(withPending.history).toHaveLength(1);

    await db('hour_blocks').where({ tenant, block_id: blockId }).update({ status: 'active', remaining_minutes: 600 });
    const active = await actions.getContractLinePrepaidBlockSummary(lineId);
    expect(active.balance).toEqual({ total_minutes: 2400, remaining_minutes: 600, active_block_count: 1 });

    const plain = await actions.getContractLinePrepaidBlockSummary(plainLine);
    expect(plain).toMatchObject({ display_kind: 'Hourly', config: null });
  });

  it('rejects bucket pools on a Prepaid Block line', async () => {
    const lineId = await newLine();
    await actions.upsertContractLinePrepaidBlock(lineId, validConfig);
    const result = await poolActions.createBucketPool(
      lineId,
      { total_minutes: 600, overage_rate: 0, allow_rollover: false, billing_period: 'monthly' },
      [{ service_id: svcA, burn_multiplier: 1 }],
    );
    expect(messageOf(result)).toContain('Cannot add a bucket pool to a Prepaid Block line');
    expect(await db('contract_line_buckets').where({ tenant, contract_line_id: lineId }).first()).toBeUndefined();
  });

  it('createCustomContractLine creates the Hourly line and its block config together, and rolls back on a bad config', async () => {
    const lineId = await runWithTenant(tenant, () => presetActions.createCustomContractLine(contractId, {
      contract_line_name: 'Custom block line', contract_line_type: 'Hourly', billing_frequency: 'monthly',
      services: [{ service_id: svcA, custom_rate: 11000 }],
      prepaid_block: { ...validConfig, trigger_threshold_percent: 80, replenishment_tier: 'auto_issue' },
    }));
    expect(typeof lineId).toBe('string');
    created.lines.push(lineId);
    const line = await db('contract_lines').where({ tenant, contract_line_id: lineId }).first();
    expect(line.contract_line_type).toBe('Hourly');
    const config = await db('contract_line_prepaid_blocks').where({ tenant, contract_line_id: lineId }).first();
    expect(config).toMatchObject({ block_minutes: 2400, trigger_threshold_percent: 80, replenishment_tier: 'auto_issue', sold_as_service_id: svcA });
    expect((await actions.getContractLinePrepaidBlockSummary(lineId)).display_kind).toBe('PrepaidBlock');

    const before = await db('contract_lines').where({ tenant, contract_line_name: 'Rolled back line' }).count<{ count: string }[]>('* as count');
    const bad = await runWithTenant(tenant, () => presetActions.createCustomContractLine(contractId, {
      contract_line_name: 'Rolled back line', contract_line_type: 'Hourly', billing_frequency: 'monthly',
      services: [{ service_id: svcA, custom_rate: 11000 }],
      prepaid_block: { ...validConfig, block_minutes: 0 },
    }));
    expect(messageOf(bad)).toContain('Cannot save prepaid block');
    const after = await db('contract_lines').where({ tenant, contract_line_name: 'Rolled back line' }).count<{ count: string }[]>('* as count');
    expect(after[0].count).toBe(before[0].count);

    const nonHourly = await runWithTenant(tenant, () => presetActions.createCustomContractLine(contractId, {
      contract_line_name: 'Fixed block', contract_line_type: 'Fixed', billing_frequency: 'monthly',
      services: [{ service_id: svcA, quantity: 1 }], prepaid_block: validConfig,
    }));
    expect(messageOf(nonHourly)).toContain('Only Hourly');
  });
});
