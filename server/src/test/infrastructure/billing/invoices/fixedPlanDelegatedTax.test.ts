import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { updateInvoiceTaxSource } from '@alga-psa/billing/actions/taxSourceActions';
import { BillingEngine } from '@alga-psa/billing/services';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { createTestDateISO } from '../../../../../test-utils/dateUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  materializeRecurringServicePeriods,
  addServiceToFixedPlan,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureClientPlanBundlesTable,
  unwrapInvoiceResult,
  generateInvoiceForCycle
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

/**
 * alga-2026-0003122: a fixed-plan charge keeps its tax on two levels — the
 * serviceless parent in invoice_charges and one invoice_charge_fixed_details row
 * per plan service. Accounting export expansion refuses to export unless the
 * allocation tax sums to the parent tax exactly, so a delegated-tax invoice must
 * normalise both levels: zero while the tax is pending in the accounting system,
 * and the imported amount split across the allocations once it arrives.
 */
describe('Fixed-plan invoice tax when tax is delegated to the accounting system', () => {
  let context: TestContext;

  // EQUIT-shaped plan: a 25000 line plus an unevenly split 68000 bundle.
  const MEMBERS = [
    { name: 'Managed workstations', catalogRate: 25_000 },
    { name: 'Managed servers', catalogRate: 40_000 },
    { name: 'Backup monitoring', catalogRate: 28_000 }
  ];
  const PLAN_FEE = MEMBERS.reduce((sum, member) => sum + member.catalogRate, 0);

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
      clientName: 'Delegated Tax Fixed Plan Client',
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
    // 10% GST on every member, exactly like the reporting tenant.
    await setupClientTaxConfiguration(context, {
      regionCode: 'AU-GST',
      regionName: 'Australia GST',
      description: 'GST',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 10
    });
    await ensureClientPlanBundlesTable(context);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  async function delegateTaxForClient() {
    await context.db('client_tax_settings')
      .where({ tenant: context.tenantId, client_id: context.clientId })
      .update({ tax_source_override: 'external' });
  }

  async function setupPlan() {
    const serviceIds: string[] = [];
    for (const member of MEMBERS) {
      serviceIds.push(
        await createTestService(context, {
          service_name: member.name,
          billing_method: 'fixed',
          default_rate: member.catalogRate,
          unit_of_measure: 'unit',
          tax_region: 'AU-GST'
        })
      );
    }

    // Services are created after the tax fixture, so point them at the rate.
    await assignServiceTaxRate(context, '*', 'AU-GST', { onlyUnset: true });

    const { planId } = await createFixedPlanAssignment(context, serviceIds[0], {
      planName: 'Managed Services Plan',
      billingFrequency: 'monthly',
      baseRateCents: PLAN_FEE,
      detailBaseRateCents: 0,
      quantity: 1,
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
      billingTiming: 'advance'
    });
    for (let i = 1; i < MEMBERS.length; i++) {
      await addServiceToFixedPlan(context, planId, serviceIds[i], { detailBaseRateCents: 0 });
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

  async function planRows(invoiceId: string) {
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
      .orderBy('f.allocated_amount', 'desc')
      .select('d.service_id', 'f.item_detail_id', 'f.allocated_amount', 'f.tax_amount', 'f.tax_rate', 'f.is_taxable');
    return { parent, details };
  }

  const sumDetailTax = (details: Array<{ tax_amount: unknown }>) =>
    details.reduce((sum, detail) => sum + Number(detail.tax_amount ?? 0), 0);

  async function generatePendingExternalInvoice() {
    const { billingCycleId } = await setupPlan();
    await delegateTaxForClient();
    const invoice = unwrapInvoiceResult<{ invoice_id: string; tax: number; subtotal: number }>(
      await generateInvoiceForCycle(billingCycleId)
    );
    const row = await context.db('invoices')
      .where({ tenant: context.tenantId, invoice_id: invoice.invoice_id })
      .first();
    expect(row.tax_source).toBe('pending_external');
    return invoice;
  }

  it('zeroes both levels while the tax is pending in the accounting system', async () => {
    const invoice = await generatePendingExternalInvoice();
    const { parent, details } = await planRows(invoice.invoice_id);

    expect(details).toHaveLength(MEMBERS.length);
    expect(Number(parent.net_amount)).toBe(PLAN_FEE);
    expect(Number(parent.tax_amount)).toBe(0);
    expect(Number(parent.total_price)).toBe(PLAN_FEE);
    expect(details.map((detail) => Number(detail.allocated_amount))).toEqual([40_000, 28_000, 25_000]);
    expect(details.every((detail) => Number(detail.tax_amount) === 0)).toBe(true);
    expect(details.every((detail) => Number(detail.tax_rate) === 0)).toBe(true);
    // Delegation is about amounts; the member taxability flags stay as computed.
    expect(details.every((detail) => detail.is_taxable === true)).toBe(true);
    expect(sumDetailTax(details)).toBe(Number(parent.tax_amount));
    expect(Number(invoice.tax)).toBe(0);
  });

  it('splits an odd imported tax across the allocations so they sum to the parent', async () => {
    const invoice = await generatePendingExternalInvoice();
    const { parent } = await planRows(invoice.invoice_id);

    // Simulate the external tax import: the provider amount lands on the charge
    // and the invoice flips to 'external', which re-runs the tax pass.
    await context.db('invoice_charges')
      .where({ tenant: context.tenantId, item_id: parent.item_id })
      .update({ external_tax_amount: 2_501 });
    const switched = await updateInvoiceTaxSource(invoice.invoice_id, 'external');
    expect(switched).toEqual({ success: true });

    const imported = await planRows(invoice.invoice_id);
    expect(Number(imported.parent.tax_amount)).toBe(2_501);
    expect(Number(imported.parent.total_price)).toBe(PLAN_FEE + 2_501);
    expect(sumDetailTax(imported.details)).toBe(2_501);
    // Every allocation records the parent's effective (blended) rate, rounded
    // by the numeric(8,2) column: 2501 / 93000 * 100 = 2.689247 -> 2.69.
    expect(imported.details.every((detail) => Number(detail.tax_rate) === 2.69)).toBe(true);

    const header = await context.db('invoices')
      .where({ tenant: context.tenantId, invoice_id: invoice.invoice_id })
      .first();
    expect(Number(header.tax)).toBe(2_501);
    expect(Number(header.total_amount)).toBe(PLAN_FEE + 2_501);
  });

  it('keeps the invariant across an internal -> pending_external -> internal round trip', async () => {
    const { billingCycleId } = await setupPlan();
    const invoice = unwrapInvoiceResult<{ invoice_id: string; tax: number }>(
      await generateInvoiceForCycle(billingCycleId)
    );

    const internal = await planRows(invoice.invoice_id);
    expect(Number(internal.parent.tax_amount)).toBe(Math.round(PLAN_FEE * 0.1));
    expect(sumDetailTax(internal.details)).toBe(Number(internal.parent.tax_amount));

    expect(await updateInvoiceTaxSource(invoice.invoice_id, 'pending_external')).toEqual({ success: true });
    const delegated = await planRows(invoice.invoice_id);
    expect(Number(delegated.parent.tax_amount)).toBe(0);
    expect(delegated.details.every((detail) => Number(detail.tax_amount) === 0)).toBe(true);
    expect(sumDetailTax(delegated.details)).toBe(0);

    expect(await updateInvoiceTaxSource(invoice.invoice_id, 'internal')).toEqual({ success: true });
    const restored = await planRows(invoice.invoice_id);
    expect(Number(restored.parent.tax_amount)).toBe(Math.round(PLAN_FEE * 0.1));
    expect(sumDetailTax(restored.details)).toBe(Number(restored.parent.tax_amount));
    expect(restored.details.every((detail) => Number(detail.tax_rate) === 10)).toBe(true);
  });

  it('re-normalises the allocations when a pending_external draft is recalculated', async () => {
    const invoice = await generatePendingExternalInvoice();
    const { details } = await planRows(invoice.invoice_id);

    // A draft left in the pre-fix state: engine tax still on the allocations.
    await context.db('invoice_charge_fixed_details')
      .where({ tenant: context.tenantId, item_detail_id: details[0].item_detail_id })
      .update({ tax_amount: 4_000, tax_rate: 10 });

    const today = new Date().toISOString().split('T')[0];
    await context.db('invoices')
      .where({ tenant: context.tenantId, invoice_id: invoice.invoice_id })
      .update({ invoice_date: today, due_date: today });
    await new BillingEngine().recalculateInvoice(invoice.invoice_id);

    const repaired = await planRows(invoice.invoice_id);
    expect(Number(repaired.parent.tax_amount)).toBe(0);
    expect(sumDetailTax(repaired.details)).toBe(0);
    expect(repaired.details.every((detail) => Number(detail.tax_rate) === 0)).toBe(true);
  });
});
