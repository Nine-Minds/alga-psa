import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import type { Knex } from 'knex';

// Guarded DB tests for the wizard submission path (plan section 7, "Contract wizard" and
// "Templates"): `prepaid_block_lines` creates one extra Hourly line per entry plus its block config
// (client wizard: validated and issuance-synced; template wizard: currency-neutral config). Run with
// HOUR_BLOCK_DB_TESTS=1 (see prepaidBlockConfigActions.db.test.ts for the env vars).
const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const connection = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

const hoisted = vi.hoisted(() => {
  const state = { db: null as any, tenant: '', userId: '00000000-0000-4000-8000-0000000000a1' };
  const withAuthMock = (fn: any) => async (...args: any[]) => {
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(state.tenant, () => fn({ user_id: state.userId, user_type: 'internal', roles: [] }, { tenant: state.tenant }, ...args));
  };
  return Object.assign(state, { withAuthMock });
});
vi.mock('@alga-psa/auth', () => ({ withAuth: hoisted.withAuthMock, getSession: vi.fn(async () => null) }));
vi.mock('@alga-psa/auth/withAuth', () => ({ withAuth: hoisted.withAuthMock }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: vi.fn(async () => ({ knex: hoisted.db, tenant: hoisted.tenant })) };
});

// The wizard publishes CONTRACT_CREATED after commit. Publishing is not what
// these tests prove, and an unreachable Redis would hang every submission.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import { getContractMonthlyFixedValuesByContract } from '../../../shared/billingClients/contractMonthlyValue';
import { contractLineRecurringStreams } from '../../../shared/billingClients/contractLineTimingRule';

const wizard = enabled ? await import('../src/actions/contractWizardActions') : (null as any);

const messageOf = (value: any): string => value?.actionError ?? value?.permissionError ?? '';

describe.runIf(enabled)('Prepaid Block lines in the contract and template wizards', () => {
  let db: Knex;
  let tenant: string;
  let clientId: string;
  let svcA: string;
  let svcB: string;
  let svcProduct: string;
  let svcFixed: string;
  const contractIds: string[] = [];
  const templateIds: string[] = [];

  const block = {
    block_minutes: 2400, block_price: 440000, expiry_months: 12, trigger_on_expiry: true, replenishment_tier: 'draft' as const,
  };

  beforeAll(async () => {
    process.env.E2E_AUTH_BYPASS = 'true';
    db = knexLib({ client: 'pg', connection, pool: { min: 0, max: 4 } });
    hoisted.db = db;
    tenant = uuidv4();
    hoisted.tenant = tenant;
    clientId = uuidv4();
    svcA = uuidv4(); svcB = uuidv4(); svcProduct = uuidv4(); svcFixed = uuidv4();
    const typeId = uuidv4();
    await db('tenants').insert({ tenant, client_name: 'PBW Tenant', email: 'pbw@test.local', billing_source: 'test' });
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'PBW Client', default_currency_code: 'EUR' });
    await db('service_types').insert({ id: typeId, tenant, name: 'PBW Type', is_active: true, order_number: 1 });
    for (const [id, name, method] of [[svcA, 'Remote Support', 'hourly'], [svcB, 'Onsite Support', 'hourly'], [svcProduct, 'Router', 'fixed'], [svcFixed, 'Managed Services', 'fixed']] as const) {
      await db('service_catalog').insert({
        service_id: id, tenant, service_name: name, custom_service_type_id: typeId, billing_method: method,
        default_rate: 11000, unit_of_measure: method === 'hourly' ? 'hour' : 'month', category_id: null, tax_rate_id: null,
        item_kind: id === svcProduct ? 'product' : 'service', is_active: true, is_license: false,
      });
    }
  });

  afterAll(async () => {
    if (!db) return;
    for (const table of [
      'contract_line_block_issuances', 'contract_line_prepaid_blocks', 'contract_template_line_prepaid_blocks',
      'contract_line_service_hourly_configs', 'contract_line_service_configuration', 'contract_line_services',
      'contract_template_line_service_hourly_config', 'contract_template_line_service_configuration',
      'contract_template_line_services', 'contract_template_line_fixed_config', 'contract_line_service_fixed_config',
      'contract_line_fixed_config', 'contract_lines', 'contract_template_lines', 'contract_templates',
      'client_contracts', 'contracts', 'service_catalog', 'service_types', 'clients', 'tenants',
    ]) {
      await db(table).where({ tenant }).delete().catch(() => undefined);
    }
    await db.destroy();
  });

  const clientSubmission = (extra: Record<string, unknown>) => ({
    contract_name: `Wizard ${uuidv4().slice(0, 6)}`,
    client_id: clientId,
    start_date: '2026-03-01',
    currency_code: 'EUR',
    enable_proration: false,
    ...extra,
  });

  it('creates one extra Hourly line per entry with its config, rates and a scheduled issuance', async () => {
    const result = await wizard.createClientContractFromWizard(clientSubmission({
      prepaid_block_lines: [
        { name: 'Support block', services: [{ service_id: svcA, hourly_rate: 12000 }, { service_id: svcB, hourly_rate: 9000 }], block: { ...block, sold_as_service_id: svcB } },
        { services: [{ service_id: svcA, hourly_rate: 11000 }], block: { ...block, block_minutes: 90, block_price: 15000, expiry_months: null, trigger_on_expiry: false } },
      ],
    }));
    expect(messageOf(result)).toBe('');
    contractIds.push(result.contract_id);

    const lines = await db('contract_lines').where({ tenant, contract_id: result.contract_id }).orderBy('contract_line_name');
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.contract_line_type === 'Hourly')).toBe(true);

    const named = lines.find((l) => l.contract_line_name === 'Support block')!;
    const config = await db('contract_line_prepaid_blocks').where({ tenant, contract_line_id: named.contract_line_id }).first();
    expect(config).toMatchObject({ block_minutes: 2400, expiry_months: 12, trigger_on_expiry: true, sold_as_service_id: svcB, replenishment_tier: 'draft' });
    expect(Number(config.block_price)).toBe(440000);

    const rates = await db('contract_line_service_configuration as c')
      .join('contract_line_service_hourly_configs as h', function () { this.on('c.config_id', 'h.config_id').andOn('c.tenant', 'h.tenant'); })
      .where('c.tenant', tenant).andWhere('c.contract_line_id', named.contract_line_id)
      .select('c.service_id', 'h.hourly_rate');
    expect(Object.fromEntries(rates.map((r) => [r.service_id, Number(r.hourly_rate)]))).toEqual({ [svcA]: 12000, [svcB]: 9000 });

    const other = lines.find((l) => l.contract_line_id !== named.contract_line_id)!;
    expect((await db('contract_line_prepaid_blocks').where({ tenant, contract_line_id: other.contract_line_id }).first()).block_minutes).toBe(90);

    // Issuance sync ran after the assignment: the contract_start issuance is scheduled for the named line.
    const issuances = await db('contract_line_block_issuances').where({ tenant, contract_line_id: named.contract_line_id });
    expect(issuances.map((r) => [r.trigger_kind, r.status])).toEqual([['contract_start', 'scheduled']]);
  });

  it('rejects a prepaid block entry whose service has no hourly rate above zero', async () => {
    const result = await wizard.createClientContractFromWizard(clientSubmission({
      prepaid_block_lines: [{ services: [{ service_id: svcA, hourly_rate: 0 }], block }],
    }));
    expect(messageOf(result)).not.toBe('');
    expect(await db('contracts').where({ tenant }).whereIn('contract_name', [result.contract_name ?? '']).first()).toBeUndefined();
  });

  it('rejects a prepaid block entry for a product (non-service) catalog item and rolls the whole submission back', async () => {
    const name = `Rollback ${uuidv4().slice(0, 6)}`;
    const result = await wizard.createClientContractFromWizard(clientSubmission({
      contract_name: name,
      prepaid_block_lines: [{ services: [{ service_id: svcProduct, hourly_rate: 5000 }], block }],
    }));
    expect(messageOf(result)).not.toBe('');
    expect(await db('contracts').where({ tenant, contract_name: name }).first()).toBeUndefined();
  });

  it('drops entries with no services and creates nothing for them', async () => {
    const result = await wizard.createClientContractFromWizard(clientSubmission({
      prepaid_block_lines: [{ services: [], block }],
    }));
    if (result.contract_id) contractIds.push(result.contract_id);
    const count = result.contract_id
      ? await db('contract_line_prepaid_blocks as p').join('contract_lines as l', function () { this.on('p.contract_line_id', 'l.contract_line_id').andOn('p.tenant', 'l.tenant'); })
        .where('l.tenant', tenant).andWhere('l.contract_id', result.contract_id).count('* as n').first()
      : { n: 0 };
    expect(Number(count!.n)).toBe(0);
  });

  it('template wizard stores a currency-neutral config row and clones it into a client contract', async () => {
    const result = await wizard.createContractTemplateFromWizard({
      contract_name: `Tpl ${uuidv4().slice(0, 6)}`,
      billing_frequency: 'monthly',
      currency_code: 'USD',
      enable_proration: false,
      fixed_services: [],
      hourly_services: [],
      usage_services: [],
      prepaid_block_lines: [
        { name: 'Template block', services: [{ service_id: svcA }, { service_id: svcB }], block: { ...block, sold_as_service_id: svcB } },
      ],
    });
    expect(messageOf(result)).toBe('');
    templateIds.push(result.contract_id);

    const templateLine = await db('contract_template_lines').where({ tenant, template_id: result.contract_id }).first();
    expect(templateLine).toMatchObject({ line_type: 'Hourly', template_line_name: 'Template block' });
    const row = await db('contract_template_line_prepaid_blocks').where({ tenant, template_line_id: templateLine.template_line_id }).first();
    expect(row).toMatchObject({ block_minutes: 2400, sold_as_service_id: svcB, expiry_months: 12 });
    expect(Number(row.block_price)).toBe(440000);
    const svcRows = await db('contract_template_line_services').where({ tenant, template_line_id: templateLine.template_line_id });
    expect(svcRows.map((r) => r.service_id).sort()).toEqual([svcA, svcB].sort());
  });
  // Contract-wide timing = advance with a cadence Prepaid Block line: the Hourly block line is
  // arrears-only (timing is per charge, not per line), and its block fee goes in advance through
  // the `prepaid_block` stream. Regression: the wizard used to stamp the contract-wide advance on
  // the block line and the contract failed validation.
  const cadenceBlock = { ...block, issue_mode: 'cadence' as const, block_minutes: 600, block_price: 150000, expiry_months: null, trigger_on_expiry: false };

  it('client wizard: contract-wide advance + cadence block saves; line is arrears, prepaid_block stream is advance', async () => {
    const result = await wizard.createClientContractFromWizard(clientSubmission({
      billing_timing: 'advance',
      billing_frequency: 'monthly',
      prepaid_block_lines: [{ name: 'Cadence block', services: [{ service_id: svcA, hourly_rate: 15000 }], block: cadenceBlock }],
    }));
    expect(messageOf(result)).toBe('');
    contractIds.push(result.contract_id);

    const line = await db('contract_lines').where({ tenant, contract_id: result.contract_id, contract_line_name: 'Cadence block' }).first();
    expect(line.billing_timing).toBe('arrears');
    const config = await db('contract_line_prepaid_blocks').where({ tenant, contract_line_id: line.contract_line_id }).first();
    expect(config.issue_mode).toBe('cadence');
    const streams = contractLineRecurringStreams(line, config);
    expect(streams.map((s) => [s.stream, s.duePosition])).toEqual([['line', 'arrears'], ['prepaid_block', 'advance']]);
  });

  it('template wizard: contract-wide advance + cadence block saves; line is arrears, prepaid_block stream is advance', async () => {
    const result = await wizard.createContractTemplateFromWizard({
      contract_name: `Tpl cadence ${uuidv4().slice(0, 6)}`,
      billing_frequency: 'monthly',
      billing_timing: 'advance',
      currency_code: 'USD',
      enable_proration: false,
      fixed_services: [],
      hourly_services: [],
      usage_services: [],
      prepaid_block_lines: [{ name: 'Tpl cadence block', services: [{ service_id: svcA }], block: cadenceBlock }],
    });
    expect(messageOf(result)).toBe('');
    templateIds.push(result.contract_id);

    const templateLine = await db('contract_template_lines').where({ tenant, template_id: result.contract_id, template_line_name: 'Tpl cadence block' }).first();
    expect(templateLine.billing_timing).toBe('arrears');
    const row = await db('contract_template_line_prepaid_blocks').where({ tenant, template_line_id: templateLine.template_line_id }).first();
    expect(row.issue_mode).toBe('cadence');
    const streams = contractLineRecurringStreams({ contract_line_type: templateLine.line_type, billing_timing: templateLine.billing_timing }, row);
    expect(streams.map((s) => [s.stream, s.duePosition])).toEqual([['line', 'arrears'], ['prepaid_block', 'advance']]);
  });
  it('acceptance contract: the monthly estimate counts the fixed fee and the cadence block fee ($3,000)', async () => {
    const result = await wizard.createClientContractFromWizard(clientSubmission({
      billing_timing: 'advance',
      billing_frequency: 'monthly',
      fixed_lines: [{ line_key: 'fixed-1', billing_frequency: 'monthly', base_rate: 150000, services: [{ service_id: svcFixed, pricing_basis: 'bundle' }] }],
      prepaid_block_lines: [{ name: 'Cadence block', services: [{ service_id: svcA, hourly_rate: 15000 }], block: cadenceBlock }],
    }));
    expect(messageOf(result)).toBe('');
    contractIds.push(result.contract_id);

    const value = (await getContractMonthlyFixedValuesByContract(db, tenant, [result.contract_id])).get(result.contract_id)!;
    expect(value.monthlyValueCents).toBe(300000);
    expect(value.hasCadencePrepaidBlock).toBe(true);
  });

  it('a consumption block adds nothing to the monthly estimate', async () => {
    const result = await wizard.createClientContractFromWizard(clientSubmission({
      prepaid_block_lines: [{ services: [{ service_id: svcA, hourly_rate: 12000 }], block }],
    }));
    contractIds.push(result.contract_id);
    const value = (await getContractMonthlyFixedValuesByContract(db, tenant, [result.contract_id])).get(result.contract_id)!;
    expect(value.monthlyValueCents).toBe(0);
    expect(value.hasCadencePrepaidBlock).toBe(false);
  });
});
