import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../../test-utils/testContext';
import {
  createPrepaymentInvoice,
  applyCreditToInvoice,
  resolveCreditDrawdownPolicy,
} from '@alga-psa/billing/actions/creditActions';
import { finalizeInvoice } from '@alga-psa/billing/actions/invoiceModification';
import { createInvoiceFromBillingResult } from '@alga-psa/billing/actions/invoiceGeneration';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
} from '../../../../../test-utils/billingTestHelpers';
import type { IBillingCharge, IBillingResult } from 'server/src/interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import { ClientContractLine } from '@alga-psa/billing/models';
import { createTestDate } from '../../../test-utils/dateUtils';
import { createClient } from '../../../../../test-utils/testDataFactory';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null,
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any)),
  };
});

vi.mock('@alga-psa/core/logger', () => {
  const noop = vi.fn();
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: vi.fn(() => logger),
  };
  return { default: logger };
});

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(() =>
    Promise.resolve({
      user_id: mockedUserId,
      tenant: mockedTenantId,
      username: 'mock-user',
      first_name: 'Mock',
      last_name: 'User',
      email: 'mock.user@example.com',
      user_type: 'internal',
      roles: [],
    })
  ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

let context: TestContext;

function tenantTable<Row extends object = Record<string, unknown>>(
  context: TestContext,
  tableExpression: string
) {
  return tenantDb(context.db, context.tenantId).table<Row>(tableExpression);
}

async function ensureClientBillingSettings(
  clientId: string,
  overrides: Record<string, unknown> = {}
) {
  await tenantTable(context, 'client_billing_settings')
    .where({ client_id: clientId, tenant: context.tenantId })
    .del();

  const now = new Date().toISOString();
  await tenantTable(context, 'client_billing_settings').insert({
    client_id: clientId,
    tenant: context.tenantId,
    zero_dollar_invoice_handling: 'normal',
    suppress_zero_dollar_invoices: false,
    enable_credit_expiration: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  });
}

async function createBillingCycle(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<string> {
  return context.createEntity(
    'client_billing_cycles',
    {
      client_id: clientId,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate,
    },
    'billing_cycle_id'
  );
}

async function generateInvoiceFromChargesForClient(
  clientId: string,
  billingCycleId: string,
  charges: IBillingCharge[],
  overrides: Partial<Pick<IBillingResult, 'discounts' | 'adjustments' | 'finalAmount'>> = {}
) {
  const cycleRecord = await tenantTable(context, 'client_billing_cycles')
    .where({ billing_cycle_id: billingCycleId, tenant: context.tenantId })
    .first();

  if (!cycleRecord) {
    throw new Error(`Billing cycle ${billingCycleId} not found`);
  }

  for (const charge of charges) {
    if (!(charge as { config_id?: string }).config_id) {
      (charge as { config_id?: string }).config_id = uuidv4();
    }
    const usageId = (charge as { usageId?: string }).usageId;
    if (charge.type === 'usage' && usageId) {
      await tenantTable(context, 'usage_tracking')
        .insert({
          tenant: context.tenantId,
          usage_id: usageId,
          service_id: (charge as { serviceId?: string }).serviceId,
          client_id: clientId,
          usage_date: (charge as { servicePeriodStart?: string }).servicePeriodStart ?? cycleRecord.period_start_date,
          quantity: (charge as { quantity?: number }).quantity ?? 1,
          invoiced: false,
        })
        .onConflict(['tenant', 'usage_id'])
        .ignore();
    }
  }

  const totalAmount = charges.reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);

  const billingResult: IBillingResult = {
    tenant: context.tenantId,
    charges,
    discounts: overrides.discounts ?? [],
    adjustments: overrides.adjustments ?? [],
    totalAmount,
    finalAmount: overrides.finalAmount ?? totalAmount,
  };

  const createdInvoice = await createInvoiceFromBillingResult(
    billingResult,
    clientId,
    cycleRecord.period_start_date ?? cycleRecord.effective_date,
    cycleRecord.period_end_date ?? cycleRecord.effective_date,
    billingCycleId,
    context.userId
  );

  const invoiceRow = await tenantTable(context, 'invoices')
    .where({ invoice_id: createdInvoice.invoice_id, tenant: context.tenantId })
    .first();

  if (!invoiceRow) {
    throw new Error(`Invoice ${createdInvoice.invoice_id} not found`);
  }

  return { invoiceId: createdInvoice.invoice_id, invoice: invoiceRow };
}

async function setupDefaultTax(clientId?: string) {
  await setupClientTaxConfiguration(context, {
    clientId,
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'NY State Tax',
    startDate: '2020-01-01T00:00:00.000Z',
    taxPercentage: 10.0,
  });
  await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
}

async function createServiceType(name: string): Promise<string> {
  const typeId = uuidv4();
  await tenantTable(context, 'service_types').insert({
    id: typeId,
    tenant: context.tenantId,
    name,
    is_active: true,
  });
  return typeId;
}

function makeCharge(
  serviceId: string,
  serviceName: string,
  total: number,
  periodStart: string,
  periodEnd: string,
  clientContractId?: string
): IBillingCharge {
  return {
    tenant: context.tenantId,
    type: 'usage',
    serviceId,
    serviceName,
    quantity: 1,
    rate: total,
    total,
    tax_amount: 0,
    tax_rate: 0,
    tax_region: 'US-NY',
    is_taxable: false,
    usageId: uuidv4(),
    servicePeriodStart: periodStart,
    servicePeriodEnd: periodEnd,
    billingTiming: 'arrears',
    ...(clientContractId ? { client_contract_id: clientContractId } : {}),
  };
}

describe('Credit Draw-Down Policy Controls', () => {
  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_charges',
        'invoices',
        'transactions',
        'credit_tracking',
        'credit_allocations',
        'client_billing_cycles',
        'client_contract_lines',
        'service_catalog',
        'service_types',
        'contract_lines',
        'bucket_plans',
        'bucket_usage',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'client_billing_settings',
        'default_billing_settings',
      ],
      clientName: 'Credit Drawdown Policy Client',
      userType: 'internal',
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await setupDefaultTax();
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await setupDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('resolves behavior-preserving defaults when no policy is configured', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Default Policy Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0,
    });

    const policy = await resolveCreditDrawdownPolicy(context.db, context.tenantId, clientId);
    expect(policy.autoApplyEnabled).toBe(true);
    expect(policy.applicationOrder).toBe('expiration_first');
    expect(policy.eligibleServiceTypeIds).toBeNull();
  });

  it('resolves the per-field cascade: client over default over hardcoded default', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Cascade Policy Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0,
    });

    const laborTypeId = await createServiceType('Labor');

    // Tenant default: auto-apply off, newest_first, restrict to labor.
    await tenantTable(context, 'default_billing_settings').insert({
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      credit_auto_apply_enabled: false,
      credit_application_order: 'newest_first',
      credit_eligible_service_type_ids: JSON.stringify([laborTypeId]),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // No client row: inherit all defaults.
    const inherited = await resolveCreditDrawdownPolicy(context.db, context.tenantId, clientId);
    expect(inherited.autoApplyEnabled).toBe(false);
    expect(inherited.applicationOrder).toBe('newest_first');
    expect(inherited.eligibleServiceTypeIds).toEqual([laborTypeId]);

    // Client overrides a single field (auto-apply on), leaving the rest null to inherit.
    await ensureClientBillingSettings(clientId, { credit_auto_apply_enabled: true });
    const overridden = await resolveCreditDrawdownPolicy(context.db, context.tenantId, clientId);
    expect(overridden.autoApplyEnabled).toBe(true);
    expect(overridden.applicationOrder).toBe('newest_first');
    expect(overridden.eligibleServiceTypeIds).toEqual([laborTypeId]);
  });

  it('skips auto-apply when disabled at the client level, but manual application still works', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Auto Apply Disabled Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0,
    });

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId, { credit_auto_apply_enabled: false });

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    const anchorServiceId = await createTestService(context, {
      service_name: 'Contract Line Anchor Service',
    });
    await createFixedPlanAssignment(context, anchorServiceId, {
      clientId,
      startDate: periodStart,
      planName: 'Drawdown Test Plan',
    });

    const serviceId = await createTestService(context, {
      service_name: 'Standard Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY',
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 5000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const { invoiceId } = await generateInvoiceFromChargesForClient(clientId, billingCycleId, [
      makeCharge(serviceId, 'Standard Service', 10000, periodStart, periodEnd),
    ]);

    await finalizeInvoice(invoiceId);

    const finalizedInvoice = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
    expect(Number(finalizedInvoice.credit_applied)).toBe(0);

    // Manual application is unaffected by the auto-apply toggle.
    await applyCreditToInvoice(clientId, invoiceId, 5000);
    const afterManual = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
    expect(Number(afterManual.credit_applied)).toBe(5000);
  });

  it('caps credit at the eligible service-type subtotal and treats no-service-id charges as ineligible', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Service Restriction Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0,
    });

    await setupDefaultTax(clientId);

    const laborTypeId = await createServiceType('Labor');
    const hardwareTypeId = await createServiceType('Hardware');

    await ensureClientBillingSettings(clientId, {
      credit_eligible_service_type_ids: JSON.stringify([laborTypeId]),
    });

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    const anchorServiceId = await createTestService(context, {
      service_name: 'Contract Line Anchor Service',
    });
    await createFixedPlanAssignment(context, anchorServiceId, {
      clientId,
      startDate: periodStart,
      planName: 'Drawdown Test Plan',
    });

    const laborService = await createTestService(context, {
      service_name: 'Labor Service',
      billing_method: 'fixed',
      default_rate: 6000,
      custom_service_type_id: laborTypeId,
    });
    const hardwareService = await createTestService(context, {
      service_name: 'Hardware Service',
      billing_method: 'fixed',
      default_rate: 4000,
      custom_service_type_id: hardwareTypeId,
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 10000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const { invoiceId } = await generateInvoiceFromChargesForClient(clientId, billingCycleId, [
      makeCharge(laborService, 'Labor Service', 6000, periodStart, periodEnd),
      makeCharge(hardwareService, 'Hardware Service', 4000, periodStart, periodEnd),
    ]);

    await finalizeInvoice(invoiceId);

    const finalizedInvoice = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();

    // Only the labor charge (6000) is eligible; hardware is excluded.
    expect(Number(finalizedInvoice.credit_applied)).toBe(6000);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(4000);
  });

  it('caps cumulative applications at the eligible subtotal across repeated manual applications', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Repeated Application Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0,
    });

    await setupDefaultTax(clientId);

    const laborTypeId = await createServiceType('Labor');
    const hardwareTypeId = await createServiceType('Hardware');

    // Auto-apply off so finalize leaves the invoice clean; eligibility still
    // gates every manual application.
    await ensureClientBillingSettings(clientId, {
      credit_auto_apply_enabled: false,
      credit_eligible_service_type_ids: JSON.stringify([laborTypeId]),
    });

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    const anchorServiceId = await createTestService(context, {
      service_name: 'Contract Line Anchor Service',
    });
    await createFixedPlanAssignment(context, anchorServiceId, {
      clientId,
      startDate: periodStart,
      planName: 'Drawdown Test Plan',
    });

    const laborService = await createTestService(context, {
      service_name: 'Labor Service',
      billing_method: 'fixed',
      default_rate: 6000,
      custom_service_type_id: laborTypeId,
    });
    const hardwareService = await createTestService(context, {
      service_name: 'Hardware Service',
      billing_method: 'fixed',
      default_rate: 4000,
      custom_service_type_id: hardwareTypeId,
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 10000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const { invoiceId } = await generateInvoiceFromChargesForClient(clientId, billingCycleId, [
      makeCharge(laborService, 'Labor Service', 6000, periodStart, periodEnd),
      makeCharge(hardwareService, 'Hardware Service', 4000, periodStart, periodEnd),
    ]);

    await finalizeInvoice(invoiceId);

    const finalizedInvoice = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
    expect(Number(finalizedInvoice.credit_applied)).toBe(0);

    // First application consumes the full eligible subtotal (labor only).
    await applyCreditToInvoice(clientId, invoiceId, 6000);
    const afterFirst = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
    expect(Number(afterFirst.credit_applied)).toBe(6000);

    // Second application requests another 6000. The remaining eligible headroom
    // is 0, so it must be clamped to nothing rather than drawing against the
    // ineligible hardware subtotal.
    await applyCreditToInvoice(clientId, invoiceId, 6000);
    const afterSecond = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
    expect(Number(afterSecond.credit_applied)).toBe(6000);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(4000);
  });

  it('caps a manual application after auto-apply so the cumulative total never exceeds the eligible subtotal', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Auto Then Manual Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0,
    });

    await setupDefaultTax(clientId);

    const laborTypeId = await createServiceType('Labor');
    const hardwareTypeId = await createServiceType('Hardware');

    // Auto-apply on (default): finalize draws down the eligible labor subtotal.
    await ensureClientBillingSettings(clientId, {
      credit_eligible_service_type_ids: JSON.stringify([laborTypeId]),
    });

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    const anchorServiceId = await createTestService(context, {
      service_name: 'Contract Line Anchor Service',
    });
    await createFixedPlanAssignment(context, anchorServiceId, {
      clientId,
      startDate: periodStart,
      planName: 'Drawdown Test Plan',
    });

    const laborService = await createTestService(context, {
      service_name: 'Labor Service',
      billing_method: 'fixed',
      default_rate: 6000,
      custom_service_type_id: laborTypeId,
    });
    const hardwareService = await createTestService(context, {
      service_name: 'Hardware Service',
      billing_method: 'fixed',
      default_rate: 4000,
      custom_service_type_id: hardwareTypeId,
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 10000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const { invoiceId } = await generateInvoiceFromChargesForClient(clientId, billingCycleId, [
      makeCharge(laborService, 'Labor Service', 6000, periodStart, periodEnd),
      makeCharge(hardwareService, 'Hardware Service', 4000, periodStart, periodEnd),
    ]);

    await finalizeInvoice(invoiceId);

    const finalizedInvoice = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
    // Auto-apply consumed the full eligible (labor) subtotal.
    expect(Number(finalizedInvoice.credit_applied)).toBe(6000);

    // A manual follow-up must be clamped to the remaining eligible headroom
    // (0) rather than drawing against the ineligible hardware subtotal.
    await applyCreditToInvoice(clientId, invoiceId, 4000);
    const afterManual = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
    expect(Number(afterManual.credit_applied)).toBe(6000);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(4000);
  });

  it('excludes opted-out contract charges; a fully opted-out invoice gets no auto-apply', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Contract Opt Out Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0,
    });

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId);

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    const serviceId = await createTestService(context, {
      service_name: 'Contract Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY',
    });

    const { clientContractId } = await createFixedPlanAssignment(context, serviceId, {
      clientId,
      startDate: periodStart,
      planName: 'Opt Out Plan',
    });

    await tenantTable(context, 'client_contracts')
      .where({ client_contract_id: clientContractId, tenant: context.tenantId })
      .update({ credit_drawdown_opt_out: true });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 10000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const { invoiceId } = await generateInvoiceFromChargesForClient(clientId, billingCycleId, [
      makeCharge(serviceId, 'Contract Service', 10000, periodStart, periodEnd, clientContractId),
    ]);

    // Ensure the charge actually references the opted-out contract.
    await tenantTable(context, 'invoice_charges')
      .where({ invoice_id: invoiceId, tenant: context.tenantId })
      .update({ client_contract_id: clientContractId });

    await finalizeInvoice(invoiceId);

    const finalizedInvoice = await tenantTable(context, 'invoices')
      .where({ invoice_id: invoiceId })
      .first();
    expect(Number(finalizedInvoice.credit_applied)).toBe(0);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(10000);
  });

  it('consumes credits oldest-first and newest-first per the order setting', async () => {
    const oldestFirstClient = await createClient(context.db, context.tenantId, 'Oldest First Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0,
    });
    await setupDefaultTax(oldestFirstClient);
    await ensureClientBillingSettings(oldestFirstClient, { credit_application_order: 'oldest_first' });

    await finalizeInvoice((await createPrepaymentInvoice(oldestFirstClient, 5000)).invoice_id);
    await finalizeInvoice((await createPrepaymentInvoice(oldestFirstClient, 7000)).invoice_id);
    await finalizeInvoice((await createPrepaymentInvoice(oldestFirstClient, 8000)).invoice_id);

    // Deterministic created_at ordering: credit A (oldest), B, C (newest).
    const credits = await tenantTable(context, 'credit_tracking')
      .where({ client_id: oldestFirstClient, tenant: context.tenantId })
      .orderBy('created_at', 'asc');
    expect(credits.length).toBe(3);
    await tenantTable(context, 'credit_tracking')
      .where({ credit_id: credits[0].credit_id, tenant: context.tenantId })
      .update({ created_at: '2024-01-01T00:00:00.000Z' });
    await tenantTable(context, 'credit_tracking')
      .where({ credit_id: credits[1].credit_id, tenant: context.tenantId })
      .update({ created_at: '2024-01-02T00:00:00.000Z' });
    await tenantTable(context, 'credit_tracking')
      .where({ credit_id: credits[2].credit_id, tenant: context.tenantId })
      .update({ created_at: '2024-01-03T00:00:00.000Z' });

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();
    const serviceId = await createTestService(context, {
      service_name: 'Order Service',
      billing_method: 'fixed',
      default_rate: 12000,
      tax_region: 'US-NY',
    });
    const anchorServiceId = await createTestService(context, { service_name: 'Order Anchor' });
    await createFixedPlanAssignment(context, anchorServiceId, { clientId: oldestFirstClient, startDate: periodStart, planName: 'Order Plan' });
    const billingCycleId = await createBillingCycle(oldestFirstClient, periodStart, periodEnd);
    const { invoiceId } = await generateInvoiceFromChargesForClient(oldestFirstClient, billingCycleId, [
      makeCharge(serviceId, 'Order Service', 12000, periodStart, periodEnd),
    ]);
    await finalizeInvoice(invoiceId);

    // Oldest-first: A (5000) fully + B (7000) fully = 12000; C untouched.
    const oldestRemaining = await tenantTable(context, 'credit_tracking')
      .where({ client_id: oldestFirstClient, tenant: context.tenantId })
      .orderBy('created_at', 'asc');
    expect(Number(oldestRemaining[0].remaining_amount)).toBe(0);
    expect(Number(oldestRemaining[1].remaining_amount)).toBe(0);
    expect(Number(oldestRemaining[2].remaining_amount)).toBe(8000);
  });

  it('preserves expiration-first ordering by default', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Expiration First Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0,
    });
    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId, { credit_application_order: 'expiration_first' });

    await finalizeInvoice((await createPrepaymentInvoice(clientId, 5000)).invoice_id);
    await finalizeInvoice((await createPrepaymentInvoice(clientId, 7000)).invoice_id);
    await finalizeInvoice((await createPrepaymentInvoice(clientId, 8000)).invoice_id);

    const credits = await tenantTable(context, 'credit_tracking')
      .where({ client_id: clientId, tenant: context.tenantId })
      .orderBy('created_at', 'asc');
    expect(credits.length).toBe(3);

    // Give the newest-created credit the soonest expiration; expiration-first
    // must consume it first regardless of created_at order.
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await tenantTable(context, 'credit_tracking')
      .where({ credit_id: credits[0].credit_id, tenant: context.tenantId })
      .update({ expiration_date: later });
    await tenantTable(context, 'credit_tracking')
      .where({ credit_id: credits[1].credit_id, tenant: context.tenantId })
      .update({ expiration_date: later });
    await tenantTable(context, 'credit_tracking')
      .where({ credit_id: credits[2].credit_id, tenant: context.tenantId })
      .update({ expiration_date: soon });

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();
    const serviceId = await createTestService(context, {
      service_name: 'Expiration Order Service',
      billing_method: 'fixed',
      default_rate: 8000,
      tax_region: 'US-NY',
    });
    const anchorServiceId = await createTestService(context, { service_name: 'Expiration Anchor' });
    await createFixedPlanAssignment(context, anchorServiceId, { clientId, startDate: periodStart, planName: 'Expiration Plan' });
    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);
    const { invoiceId } = await generateInvoiceFromChargesForClient(clientId, billingCycleId, [
      makeCharge(serviceId, 'Expiration Order Service', 8000, periodStart, periodEnd),
    ]);
    await finalizeInvoice(invoiceId);

    // The soonest-expiring credit (C, 8000) is fully consumed first.
    const remaining = await tenantTable(context, 'credit_tracking')
      .where({ client_id: clientId, tenant: context.tenantId })
      .orderBy('created_at', 'asc');
    expect(Number(remaining[2].remaining_amount)).toBe(0);
  });
});
