import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { generateInvoice, previewInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import { BillingEngine } from '@alga-psa/billing/services';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  assignContractLineToClient,
  createTestService,
  createFixedPlanAssignment,
  materializeRecurringServicePeriods,
  addServiceToFixedPlan,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureClientPlanBundlesTable,
  unwrapInvoiceResult
} from '../../../../../test-utils/billingTestHelpers';

// Override DB_PORT to connect directly to PostgreSQL instead of pgbouncer
process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;


vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/secrets', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowEventModel: {
    create: vi.fn(),
  },
}));

vi.mock('@alga-psa/workflow-streams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/workflow-streams')>()),
  getRedisStreamClient: () => ({
    publishEvent: vi.fn(),
  }),
  toStreamEvent: (event: unknown) => event,
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

interface BundleMember {
  name: string;
  /** Catalog price in cents (the FMV weight). */
  catalogRate: number;
  /** Tax region of the member's tax rate; null = member is not taxable. */
  region: string | null;
  /** Stored per-service share (contract_line_service_fixed_config.base_rate). */
  share?: number;
}

describe('Saved invoice tax for mixed-taxability fixed bundles (preview == saved)', () => {
  let context: TestContext;

  async function configureTax() {
    // Client default region is whichever configuration runs last.
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-FL',
      regionName: 'Florida',
      description: 'FL State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 6
    });
    await ensureClientPlanBundlesTable(context);
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_charges',
        'invoices',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'next_number'
      ],
      clientName: 'Mixed Taxability Bundle Client',
      userType: 'internal'
    });
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({ tenantId: context.tenantId, userId: context.userId, permissionCheck: () => true });
    await context.db('next_number').insert({
      tenant: context.tenantId,
      entity_type: 'INVOICE',
      prefix: 'INV-',
      last_number: 0,
      initial_value: 1,
      padding_length: 6
    });
    await configureTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  async function setupBundle(feeCents: number, members: BundleMember[]) {
    const serviceIds: string[] = [];
    for (const member of members) {
      serviceIds.push(
        await createTestService(context, {
          service_name: member.name,
          billing_method: 'fixed',
          default_rate: member.catalogRate,
          unit_of_measure: 'unit',
          ...(member.region ? { tax_region: member.region } : {})
        })
      );
    }

    const { planId } = await createFixedPlanAssignment(context, serviceIds[0], {
      planName: 'Mixed Taxability Bundle',
      billingFrequency: 'monthly',
      baseRateCents: feeCents,
      detailBaseRateCents: members[0].share ?? 0,
      quantity: 1,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      billingTiming: 'advance'
    });
    for (let i = 1; i < members.length; i++) {
      await addServiceToFixedPlan(context, planId, serviceIds[i], {
        detailBaseRateCents: members[i].share ?? 0
      });
    }
    // The fixture seeds the first member's share from the line fee; pin every
    // member's stored share explicitly so zero-FMV allocation is deterministic.
    for (let i = 0; i < members.length; i++) {
      const configs = context.db('contract_line_service_configuration')
        .where({ tenant: context.tenantId, contract_line_id: planId, service_id: serviceIds[i] })
        .select('config_id');
      await context.db('contract_line_service_fixed_config')
        .where({ tenant: context.tenantId })
        .whereIn('config_id', configs)
        .update({ base_rate: members[i].share ?? 0 });
    }
    await materializeRecurringServicePeriods(context, planId);

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_start_date: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      period_end_date: createTestDateISO({ year: 2023, month: 2, day: 1 })
    }, 'billing_cycle_id');

    return { serviceIds, billingCycleId };
  }

  async function previewTax(billingCycleId: string): Promise<number> {
    const preview = await previewInvoice(billingCycleId);
    if (!preview.success) throw new Error(JSON.stringify(preview));
    return Number(preview.data.tax);
  }

  async function bundleRows(invoiceId: string) {
    const parent = await context.db('invoice_charges')
      .where({ tenant: context.tenantId, invoice_id: invoiceId })
      .whereNull('service_id')
      .first();
    const details = await context.db('invoice_charge_details as d')
      .join('invoice_charge_fixed_details as f', function () {
        this.on('f.tenant', 'd.tenant').andOn('f.item_detail_id', 'd.item_detail_id');
      })
      .where('d.tenant', context.tenantId)
      .where('d.item_id', parent.item_id)
      .select('d.service_id', 'f.item_detail_id', 'f.allocated_amount', 'f.tax_amount', 'f.tax_rate', 'f.is_taxable', 'f.tax_region');
    return { parent, details };
  }

  async function savedInvoiceTax(invoiceId: string): Promise<number> {
    const row = await context.db('invoices').where({ tenant: context.tenantId, invoice_id: invoiceId }).first();
    return Number(row.tax);
  }

  async function generateSaved(billingCycleId: string) {
    return unwrapInvoiceResult<{ invoice_id: string; tax: number; subtotal: number }>(
      await generateInvoice(billingCycleId)
    );
  }

  async function recalc(invoiceId: string) {
    const today = new Date().toISOString().split('T')[0];
    await context.db('invoices')
      .where({ tenant: context.tenantId, invoice_id: invoiceId })
      .update({ invoice_date: today, due_date: today });
    await new BillingEngine().recalculateInvoice(invoiceId);
  }

  const S1_MEMBERS: BundleMember[] = [
    { name: 'Taxable member', catalogRate: 22500, region: 'US-FL' },
    { name: 'Non-taxable member', catalogRate: 67500, region: null }
  ];

  it('S1: proportional FMV 225/675 – preview, saved invoice and parent tax are all 1350 cents', async () => {
    const { serviceIds, billingCycleId } = await setupBundle(90000, S1_MEMBERS);

    const preview = await previewTax(billingCycleId);
    const invoice = await generateSaved(billingCycleId);

    expect(preview).toBe(1350);
    expect(Number(invoice.tax)).toBe(1350);
    expect(await savedInvoiceTax(invoice.invoice_id)).toBe(1350);

    const { parent, details } = await bundleRows(invoice.invoice_id);
    expect(Number(parent.tax_amount)).toBe(1350);
    expect(Number(parent.net_amount)).toBe(90000);
    expect(parent.is_taxable).toBe(true);

    const taxable = details.find((d) => d.service_id === serviceIds[0])!;
    const nonTaxable = details.find((d) => d.service_id === serviceIds[1])!;
    expect(Number(taxable.allocated_amount)).toBe(22500);
    expect(Number(taxable.tax_amount)).toBe(1350);
    expect(taxable.is_taxable).toBe(true);
    expect(taxable.tax_region).toBe('US-FL');
    expect(Number(nonTaxable.allocated_amount)).toBe(67500);
    expect(Number(nonTaxable.tax_amount)).toBe(0);
    expect(nonTaxable.is_taxable).toBe(false);
  });

  it('R: custom FMV 90/810 – preview and saved tax are both 540 cents', async () => {
    const { billingCycleId } = await setupBundle(90000, [
      { name: 'Taxable member', catalogRate: 9000, region: 'US-FL' },
      { name: 'Non-taxable member', catalogRate: 81000, region: null }
    ]);
    const preview = await previewTax(billingCycleId);
    const invoice = await generateSaved(billingCycleId);
    expect(preview).toBe(540);
    expect(Number(invoice.tax)).toBe(540);
    expect(await savedInvoiceTax(invoice.invoice_id)).toBe(540);
  });

  it('S2: zero catalog prices with stored shares – preview tax equals saved tax', async () => {
    const { billingCycleId } = await setupBundle(90000, [
      { name: 'Taxable member', catalogRate: 0, region: 'US-FL', share: 22500 },
      { name: 'Non-taxable member', catalogRate: 0, region: null, share: 67500 }
    ]);
    const preview = await previewTax(billingCycleId);
    const invoice = await generateSaved(billingCycleId);
    expect(preview).toBe(1350);
    expect(Number(invoice.tax)).toBe(preview);
    expect(await savedInvoiceTax(invoice.invoice_id)).toBe(preview);
  });

  it('T: zero FMV and no shares (quantity/even fallback) – preview tax equals saved tax', async () => {
    const { billingCycleId } = await setupBundle(90000, [
      { name: 'Taxable member', catalogRate: 0, region: 'US-FL' },
      { name: 'Non-taxable member', catalogRate: 0, region: null }
    ]);
    const preview = await previewTax(billingCycleId);
    const invoice = await generateSaved(billingCycleId);
    expect(preview).toBe(2700);
    expect(Number(invoice.tax)).toBe(preview);
    expect(await savedInvoiceTax(invoice.invoice_id)).toBe(preview);
  });

  it('recalculation after adding a manual taxable line keeps the bundle tax and adds only the line tax', async () => {
    const { billingCycleId } = await setupBundle(90000, S1_MEMBERS);
    const invoice = await generateSaved(billingCycleId);
    expect(await savedInvoiceTax(invoice.invoice_id)).toBe(1350);

    await context.db('invoice_charges').insert({
      item_id: uuidv4(),
      invoice_id: invoice.invoice_id,
      description: 'Manual taxable line',
      quantity: 1,
      unit_price: 10000,
      net_amount: 10000,
      tax_amount: 0,
      tax_rate: 0,
      tax_region: 'US-FL',
      is_taxable: true,
      is_manual: true,
      is_discount: false,
      total_price: 10000,
      tenant: context.tenantId,
      created_at: new Date().toISOString(),
      created_by: context.userId
    });

    await recalc(invoice.invoice_id);

    const { parent } = await bundleRows(invoice.invoice_id);
    expect(Number(parent.tax_amount)).toBe(1350);
    expect(await savedInvoiceTax(invoice.invoice_id)).toBe(1350 + 600);
  });

  it('repairs a stale draft: a non-taxable detail with leftover tax drops to 0 on recalculation', async () => {
    const { serviceIds, billingCycleId } = await setupBundle(90000, S1_MEMBERS);
    const invoice = await generateSaved(billingCycleId);
    const { parent, details } = await bundleRows(invoice.invoice_id);
    const nonTaxable = details.find((d) => d.service_id === serviceIds[1])!;

    // Simulate a draft overtaxed by the old code.
    await context.db('invoice_charge_fixed_details')
      .where({ tenant: context.tenantId, item_detail_id: nonTaxable.item_detail_id })
      .update({ tax_amount: 4050, tax_rate: 6 });
    await context.db('invoice_charges')
      .where({ tenant: context.tenantId, item_id: parent.item_id })
      .update({ tax_amount: 5400 });

    await recalc(invoice.invoice_id);

    const repaired = await bundleRows(invoice.invoice_id);
    const repairedNonTaxable = repaired.details.find((d) => d.service_id === serviceIds[1])!;
    expect(Number(repairedNonTaxable.tax_amount)).toBe(0);
    expect(Number(repairedNonTaxable.tax_rate)).toBe(0);
    expect(Number(repaired.parent.tax_amount)).toBe(1350);
    expect(await savedInvoiceTax(invoice.invoice_id)).toBe(1350);
  });

  it('a parent explicitly marked non-taxable forces every detail to 0 tax', async () => {
    const { billingCycleId } = await setupBundle(90000, S1_MEMBERS);
    const invoice = await generateSaved(billingCycleId);
    const { parent } = await bundleRows(invoice.invoice_id);

    await context.db('invoice_charges')
      .where({ tenant: context.tenantId, item_id: parent.item_id })
      .update({ is_taxable: false });

    await recalc(invoice.invoice_id);

    const after = await bundleRows(invoice.invoice_id);
    expect(after.details.every((d) => Number(d.tax_amount) === 0)).toBe(true);
    expect(Number(after.parent.tax_amount)).toBe(0);
    expect(await savedInvoiceTax(invoice.invoice_id)).toBe(0);
  });

  it('legacy rows with NULL member flags under a taxable parent are taxed on the full parent basis, as before', async () => {
    const { billingCycleId } = await setupBundle(90000, S1_MEMBERS);
    const invoice = await generateSaved(billingCycleId);
    const { parent } = await bundleRows(invoice.invoice_id);

    await context.db('invoice_charge_fixed_details as f')
      .whereIn('f.item_detail_id', context.db('invoice_charge_details').where({ tenant: context.tenantId, item_id: parent.item_id }).select('item_detail_id'))
      .where('f.tenant', context.tenantId)
      .update({ is_taxable: null, tax_region: null });

    await recalc(invoice.invoice_id);

    const after = await bundleRows(invoice.invoice_id);
    expect(after.details.every((d) => d.is_taxable === null)).toBe(true);
    expect(Number(after.parent.tax_amount)).toBe(5400); // 6% of 90000: legacy inherit-from-parent
    expect(await savedInvoiceTax(invoice.invoice_id)).toBe(5400);
  });

  it('mixed regions: each taxable member is taxed at its own region rate and matches the preview', async () => {
    const { serviceIds, billingCycleId } = await setupBundle(90000, [
      { name: 'FL member', catalogRate: 22500, region: 'US-FL' },
      { name: 'NY member', catalogRate: 67500, region: 'US-NY' }
    ]);
    const preview = await previewTax(billingCycleId);
    const invoice = await generateSaved(billingCycleId);

    const { details } = await bundleRows(invoice.invoice_id);
    const fl = details.find((d) => d.service_id === serviceIds[0])!;
    const ny = details.find((d) => d.service_id === serviceIds[1])!;
    expect(fl.tax_region).toBe('US-FL');
    expect(ny.tax_region).toBe('US-NY');
    expect(Number(fl.tax_amount)).toBe(1350); // 6% of 22500
    expect(Math.abs(Number(ny.tax_amount) - 5990.625)).toBeLessThan(1); // 8.875% of 67500
    expect(Number(invoice.tax)).toBe(preview);
    expect(await savedInvoiceTax(invoice.invoice_id)).toBe(preview);
  });
});
