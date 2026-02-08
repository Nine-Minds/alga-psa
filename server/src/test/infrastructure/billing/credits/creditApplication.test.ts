import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { createPrepaymentInvoice, applyCreditToInvoice } from '@alga-psa/billing/actions/creditActions';
import { finalizeInvoice } from '@alga-psa/billing/actions/invoiceModification';
import { createInvoiceFromBillingResult } from '@alga-psa/billing/actions/invoiceGeneration';
import {
  createTestService,
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import type { IBillingCharge, IBillingResult } from 'server/src/interfaces/billing.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import { ClientContractLine } from '@alga-psa/billing/models';
import { createTestDate } from '../../../test-utils/dateUtils';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { createClient } from '../../../../../test-utils/testDataFactory';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
  };
});

vi.mock('@alga-psa/core/logger', () => {
  const noop = vi.fn();
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: vi.fn(() => logger)
  };
  return { default: logger };
});

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve({
    user_id: mockedUserId,
    tenant: mockedTenantId,
    username: 'mock-user',
    first_name: 'Mock',
    last_name: 'User',
    email: 'mock.user@example.com',
    user_type: 'internal',
    roles: []
  }))
}));

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

let context: TestContext;

function parseInvoiceTotals(invoice: Record<string, unknown>) {
  const subtotal = Number(invoice.subtotal ?? 0);
  const tax = Number(invoice.tax ?? 0);
  const creditApplied = Number(invoice.credit_applied ?? 0);
  const totalAmount = Number(invoice.total_amount ?? 0);
  return {
    subtotal,
    tax,
    creditApplied,
    totalAmount,
    totalBeforeCredit: subtotal + tax,
    amountDue: totalAmount
  };
}

async function ensureClientBillingSettings(
  clientId: string,
  overrides: Record<string, unknown> = {}
) {
  await context.db('client_billing_settings')
    .where({ client_id: clientId, tenant: context.tenantId })
    .del();

  const now = new Date().toISOString();
  await context.db('client_billing_settings').insert({
    client_id: clientId,
    tenant: context.tenantId,
    zero_dollar_invoice_handling: 'normal',
    suppress_zero_dollar_invoices: false,
    enable_credit_expiration: false,
    created_at: now,
    updated_at: now,
    ...overrides
  });
}

async function ensureClientContractLine(
  clientId: string,
  startDate: string
): Promise<void> {
  const existing = await context.db('client_contract_lines')
    .where({ client_id: clientId, tenant: context.tenantId, is_active: true })
    .first();

  if (existing) {
    return;
  }

  const contractLineId = uuidv4();
  await context.db('contract_lines').insert({
    contract_line_id: contractLineId,
    tenant: context.tenantId,
    contract_line_name: 'Test Contract Line',
    billing_frequency: 'monthly',
    is_custom: false,
    contract_line_type: 'Fixed',
    custom_rate: 0,
    enable_proration: false,
    billing_cycle_alignment: 'start',
    billing_timing: 'arrears'
  });

  await context.db('client_contract_lines').insert({
    client_contract_line_id: uuidv4(),
    client_id: clientId,
    contract_line_id: contractLineId,
    tenant: context.tenantId,
    start_date: startDate,
    is_active: true
  });
}

async function createBillingCycle(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<string> {
  return context.createEntity('client_billing_cycles', {
    client_id: clientId,
    billing_cycle: 'monthly',
    period_start_date: startDate,
    period_end_date: endDate,
    effective_date: startDate
  }, 'billing_cycle_id');
}

async function generateInvoiceFromChargesForClient(
  clientId: string,
  billingCycleId: string,
  charges: IBillingCharge[],
  overrides: Partial<Pick<IBillingResult, 'discounts' | 'adjustments' | 'finalAmount'>> = {}
) {
  const cycleRecord = await context.db('client_billing_cycles')
    .where({ billing_cycle_id: billingCycleId, tenant: context.tenantId })
    .first();

  if (!cycleRecord) {
    throw new Error(`Billing cycle ${billingCycleId} not found`);
  }

  const totalAmount = charges.reduce(
    (sum, charge) => sum + Number(charge.total ?? 0),
    0
  );

  const billingResult: IBillingResult = {
    tenant: context.tenantId,
    charges,
    discounts: overrides.discounts ?? [],
    adjustments: overrides.adjustments ?? [],
    totalAmount,
    finalAmount: overrides.finalAmount ?? totalAmount
  };

  const createdInvoice = await createInvoiceFromBillingResult(
    billingResult,
    clientId,
    cycleRecord.period_start_date ?? cycleRecord.effective_date,
    cycleRecord.period_end_date ?? cycleRecord.effective_date,
    billingCycleId,
    context.userId
  );

  const invoiceRow = await context.db('invoices')
    .where({ invoice_id: createdInvoice.invoice_id, tenant: context.tenantId })
    .first();

  if (!invoiceRow) {
    throw new Error(`Invoice ${createdInvoice.invoice_id} not found`);
  }

  return {
    invoiceId: createdInvoice.invoice_id,
    invoice: invoiceRow
  };
}

async function setupDefaultTax(clientId?: string) {
  await setupClientTaxConfiguration(context, {
    clientId,
    regionCode: 'US-NY',
    regionName: 'New York',
    description: 'NY State Tax',
    startDate: '2020-01-01T00:00:00.000Z',
    taxPercentage: 10.0
  });
  await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
}

describe('Credit Application Tests', () => {
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
        'contract_lines',
        'bucket_plans',
        'bucket_usage',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'client_billing_settings',
        'default_billing_settings'
      ],
      clientName: 'Credit Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
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
      permissionCheck: () => true
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

  it('should correctly apply credit when available credit is less than the invoice total', async () => {
    const clientId = context.clientId;

    await ensureClientBillingSettings(clientId);

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    await ensureClientContractLine(clientId, periodStart);

    const serviceId = await createTestService(context, {
      service_name: 'Premium Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const charges: IBillingCharge[] = [
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId,
        serviceName: 'Premium Service',
        quantity: 1,
        rate: 10000,
        total: 10000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: true,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      }
    ];

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 5000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const { invoiceId } = await generateInvoiceFromChargesForClient(
      clientId,
      billingCycleId,
      charges
    );

    await finalizeInvoice(invoiceId);

    const finalizedInvoice = await context.db('invoices')
      .where({ invoice_id: invoiceId })
      .first();

    const totals = parseInvoiceTotals(finalizedInvoice);
    expect(totals.creditApplied).toBe(5000);
    expect(totals.totalAmount).toBe(totals.totalBeforeCredit - 5000);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(0);

    const creditTransaction = await context.db('transactions')
      .where({
        client_id: clientId,
        invoice_id: invoiceId,
        type: 'credit_application',
        tenant: context.tenantId
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(Number(creditTransaction.amount)).toBe(-5000);
  });

  it('should correctly apply credit when available credit exceeds the invoice total', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Excess Credit Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0
    });

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId);

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    await ensureClientContractLine(clientId, periodStart);

    const serviceId = await createTestService(context, {
      service_name: 'Standard Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const charges: IBillingCharge[] = [
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId,
        serviceName: 'Standard Service',
        quantity: 1,
        rate: 10000,
        total: 10000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: true,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      }
    ];

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 20000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const { invoiceId } = await generateInvoiceFromChargesForClient(
      clientId,
      billingCycleId,
      charges
    );

    await finalizeInvoice(invoiceId);

    const finalizedInvoice = await context.db('invoices')
      .where({ invoice_id: invoiceId })
      .first();

    const totals = parseInvoiceTotals(finalizedInvoice);
    expect(totals.totalAmount).toBe(0);
    expect(totals.creditApplied).toBe(totals.totalBeforeCredit);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(20000 - totals.totalBeforeCredit);
  });

  it('should validate partial credit application when credit is less than invoice total', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Partial Credit Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0
    });

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId);

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    await ensureClientContractLine(clientId, periodStart);

    const premiumService = await createTestService(context, {
      service_name: 'Premium Service',
      billing_method: 'fixed',
      default_rate: 15000,
      tax_region: 'US-NY'
    });

    const addonService = await createTestService(context, {
      service_name: 'Addon Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const charges: IBillingCharge[] = [
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId: premiumService,
        serviceName: 'Premium Service',
        quantity: 1,
        rate: 15000,
        total: 15000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: true,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      },
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId: addonService,
        serviceName: 'Addon Service',
        quantity: 1,
        rate: 10000,
        total: 10000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: true,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      }
    ];

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 10000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const { invoiceId } = await generateInvoiceFromChargesForClient(
      clientId,
      billingCycleId,
      charges
    );

    await finalizeInvoice(invoiceId);

    const finalizedInvoice = await context.db('invoices')
      .where({ invoice_id: invoiceId })
      .first();

    const totals = parseInvoiceTotals(finalizedInvoice);
    expect(totals.creditApplied).toBe(10000);
    expect(totals.totalAmount).toBe(totals.totalBeforeCredit - 10000);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(0);
  });

  it('should verify credit application after discounts are applied', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Discount Credit Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0
    });

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId);

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    await ensureClientContractLine(clientId, periodStart);

    const serviceId = await createTestService(context, {
      service_name: 'Consulting Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const charges: IBillingCharge[] = [
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId,
        serviceName: 'Consulting Service',
        quantity: 1,
        rate: 10000,
        total: 10000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: true,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      },
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId,
        serviceName: 'Applied Discount',
        quantity: 1,
        rate: -2000,
        total: -2000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: false,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      }
    ];

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 8000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const { invoiceId } = await generateInvoiceFromChargesForClient(
      clientId,
      billingCycleId,
      charges
    );

    await finalizeInvoice(invoiceId);

    const finalizedInvoice = await context.db('invoices')
      .where({ invoice_id: invoiceId })
      .first();

    const totals = parseInvoiceTotals(finalizedInvoice);
    expect(totals.creditApplied).toBe(Math.min(8000, totals.totalBeforeCredit));
    expect(totals.totalAmount).toBe(totals.totalBeforeCredit - totals.creditApplied);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(8000 - totals.creditApplied);
  });

  it('should create credits from regular invoices with negative totals when they are finalized', async () => {
    const clientId = await createClient(
      context.db,
      context.tenantId,
      'Negative Invoice Credit Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId);

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    await ensureClientContractLine(clientId, periodStart);

    const creditServiceA = await createTestService(context, {
      service_name: 'Credit Adjustment A',
      billing_method: 'fixed',
      default_rate: -5000,
      tax_region: 'US-NY'
    });

    const creditServiceB = await createTestService(context, {
      service_name: 'Credit Adjustment B',
      billing_method: 'fixed',
      default_rate: -7500,
      tax_region: 'US-NY'
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const charges: IBillingCharge[] = [
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId: creditServiceA,
        serviceName: 'Credit Adjustment A',
        quantity: 1,
        rate: -5000,
        total: -5000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: false,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      },
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId: creditServiceB,
        serviceName: 'Credit Adjustment B',
        quantity: 1,
        rate: -7500,
        total: -7500,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: false,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      }
    ];

    const { invoiceId, invoice } = await generateInvoiceFromChargesForClient(
      clientId,
      billingCycleId,
      charges
    );

    expect(Number(invoice.total_amount)).toBe(-12500);

    await finalizeInvoice(invoiceId);

    const clientCredit = await ClientContractLine.getClientCredit(clientId);
    expect(clientCredit).toBe(12500);

    const creditTransaction = await context.db('transactions')
      .where({
        client_id: clientId,
        invoice_id: invoiceId,
        type: 'credit_issuance_from_negative_invoice',
        tenant: context.tenantId
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(Number(creditTransaction.amount)).toBe(12500);
  });

  it('should create credits with expiration dates from negative invoices', async () => {
    const clientId = await createClient(
      context.db,
      context.tenantId,
      'Negative Invoice Expiration Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId, {
      enable_credit_expiration: true,
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1]
    });

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    await ensureClientContractLine(clientId, periodStart);

    const creditService = await createTestService(context, {
      service_name: 'Credit Adjustment',
      billing_method: 'fixed',
      default_rate: -10000,
      tax_region: 'US-NY'
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const charges: IBillingCharge[] = [
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId: creditService,
        serviceName: 'Credit Adjustment',
        quantity: 1,
        rate: -10000,
        total: -10000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: false,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      }
    ];

    const { invoiceId } = await generateInvoiceFromChargesForClient(
      clientId,
      billingCycleId,
      charges
    );

    await finalizeInvoice(invoiceId);

    const creditTracking = await context.db('credit_tracking')
      .where({ client_id: clientId, tenant: context.tenantId })
      .first();

    expect(creditTracking).toBeTruthy();
    expect(creditTracking.is_expired).toBe(false);
    expect(creditTracking.expiration_date).toBeTruthy();

    const expirationDate = new Date(creditTracking.expiration_date);
    const today = new Date();
    const daysDiff = Math.round(
      (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    expect(daysDiff).toBeGreaterThanOrEqual(28);
    expect(daysDiff).toBeLessThanOrEqual(32);
  });

  it('should use default billing settings for credit expiration when client settings are not available', async () => {
    await context.db('default_billing_settings')
      .where({ tenant: context.tenantId })
      .del();

    await context.db('default_billing_settings').insert({
      tenant: context.tenantId,
      enable_credit_expiration: true,
      credit_expiration_days: 60,
      credit_expiration_notification_days: [14, 7, 1],
      suppress_zero_dollar_invoices: false,
      zero_dollar_invoice_handling: 'normal',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    const clientId = await createClient(
      context.db,
      context.tenantId,
      'Default Expiration Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    await setupDefaultTax(clientId);

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    await ensureClientContractLine(clientId, periodStart);

    const creditService = await createTestService(context, {
      service_name: 'Default Expiration Credit',
      billing_method: 'fixed',
      default_rate: -8000,
      tax_region: 'US-NY'
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const charges: IBillingCharge[] = [
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId: creditService,
        serviceName: 'Default Expiration Credit',
        quantity: 1,
        rate: -8000,
        total: -8000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: false,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      }
    ];

    const { invoiceId } = await generateInvoiceFromChargesForClient(
      clientId,
      billingCycleId,
      charges
    );

    await finalizeInvoice(invoiceId);

    const creditTracking = await context.db('credit_tracking')
      .where({ client_id: clientId, tenant: context.tenantId })
      .first();

    expect(creditTracking).toBeTruthy();

    const expirationDate = new Date(creditTracking.expiration_date);
    const today = new Date();
    const daysDiff = Math.round(
      (expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    expect(daysDiff).toBeGreaterThanOrEqual(58);
    expect(daysDiff).toBeLessThanOrEqual(62);
  });

  it('should prioritize credits by expiration date when applying to invoices', async () => {
    const clientId = await createClient(
      context.db,
      context.tenantId,
      'Credit Priority Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId, {
      enable_credit_expiration: true,
      credit_expiration_days: 90,
      credit_expiration_notification_days: [7, 1]
    });

    const baseDate = Temporal.PlainDate.from(createTestDate());
    const periodStart = baseDate.subtract({ months: 1 }).toString();
    const periodEnd = baseDate.toString();

    await ensureClientContractLine(clientId, periodStart);

    const serviceId = await createTestService(context, {
      service_name: 'Priority Service',
      billing_method: 'fixed',
      default_rate: 20000,
      tax_region: 'US-NY'
    });

    const creditDates = [
      baseDate.add({ days: 5 }).toString(),
      baseDate.add({ days: 10 }).toString(),
      null
    ];

    const amounts = [5000, 7000, 8000];

    for (let i = 0; i < amounts.length; i++) {
      const invoice = await createPrepaymentInvoice(clientId, amounts[i], creditDates[i] ?? undefined);
      await finalizeInvoice(invoice.invoice_id);
    }

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const charges: IBillingCharge[] = [
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId,
        serviceName: 'Priority Service',
        quantity: 1,
        rate: 20000,
        total: 20000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: true,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      }
    ];

    const { invoiceId } = await generateInvoiceFromChargesForClient(
      clientId,
      billingCycleId,
      charges
    );

    await finalizeInvoice(invoiceId);

    const creditEntries = await context.db('credit_tracking')
      .where({ client_id: clientId, tenant: context.tenantId })
      .orderBy('expiration_date', 'asc');

    expect(creditEntries.length).toBe(3);
    const normalized = creditEntries
      .map(entry => ({
        remaining: Number(entry.remaining_amount),
        expiration: entry.expiration_date ? new Date(entry.expiration_date).toISOString() : null
      }))
      .sort((a, b) => {
        if (a.expiration === null && b.expiration === null) return 0;
        if (a.expiration === null) return 1;
        if (b.expiration === null) return -1;
        return a.expiration.localeCompare(b.expiration);
      });

    expect(normalized[0].remaining).toBe(0);
    expect(normalized[1].remaining).toBe(0);
    expect(normalized[2].remaining).toBe(0);
  });

  it('should correctly apply partial credit across multiple invoices', async () => {
    const clientId = await createClient(
      context.db,
      context.tenantId,
      'Multi Invoice Credit Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId);

    const now = Temporal.PlainDate.from(createTestDate());

    await ensureClientContractLine(clientId, now.subtract({ months: 2 }).toString());

    const serviceId = await createTestService(context, {
      service_name: 'Recurring Service',
      billing_method: 'fixed',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 20000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const cycles: Array<{ id: string; start: string; end: string }> = [];
    for (let i = 0; i < 2; i++) {
      const start = now.subtract({ months: 2 - i }).toString();
      const end = now.subtract({ months: 1 - i }).toString();
      const id = await createBillingCycle(clientId, start, end);
      cycles.push({ id, start, end });
    }

    for (const cycle of cycles) {
      const charges: IBillingCharge[] = [
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId,
          serviceName: 'Recurring Service',
          quantity: 1,
          rate: 10000,
          total: 10000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: true,
          usageId: uuidv4(),
          servicePeriodStart: cycle.start,
          servicePeriodEnd: cycle.end,
          billingTiming: 'arrears'
        }
      ];

      const { invoiceId } = await generateInvoiceFromChargesForClient(
        clientId,
        cycle.id,
        charges
      );

      await finalizeInvoice(invoiceId);
    }

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBeGreaterThanOrEqual(0);
    expect(remainingCredit).toBeLessThan(20000);
  });

  it('should correctly apply partial credit across three invoices with partial credit on the third', async () => {
    const clientId = await createClient(
      context.db,
      context.tenantId,
      'Three Invoice Credit Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId);

    const now = Temporal.PlainDate.from(createTestDate());

    await ensureClientContractLine(clientId, now.subtract({ months: 3 }).toString());

    const serviceId = await createTestService(context, {
      service_name: 'Tiered Service',
      billing_method: 'fixed',
      default_rate: 12000,
      tax_region: 'US-NY'
    });

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 25000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const cycles: Array<{ id: string; start: string; end: string }> = [];
    for (let i = 0; i < 3; i++) {
      const start = now.subtract({ months: 3 - i }).toString();
      const end = now.subtract({ months: 2 - i }).toString();
      const id = await createBillingCycle(clientId, start, end);
      cycles.push({ id, start, end });
    }

    for (const cycle of cycles) {
      const charges: IBillingCharge[] = [
        {
          tenant: context.tenantId,
          type: 'usage',
          serviceId,
          serviceName: 'Tiered Service',
          quantity: 1,
          rate: 12000,
          total: 12000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: 'US-NY',
          is_taxable: true,
          usageId: uuidv4(),
          servicePeriodStart: cycle.start,
          servicePeriodEnd: cycle.end,
          billingTiming: 'arrears'
        }
      ];

      const { invoiceId } = await generateInvoiceFromChargesForClient(
        clientId,
        cycle.id,
        charges
      );

      await finalizeInvoice(invoiceId);
    }

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBeGreaterThanOrEqual(0);
    expect(remainingCredit).toBeLessThanOrEqual(5000);
  });

  it('should apply manual credit allocations when credits are applied programmatically', async () => {
    const clientId = await createClient(
      context.db,
      context.tenantId,
      'Manual Credit Allocation Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    await setupDefaultTax(clientId);
    await ensureClientBillingSettings(clientId);

    const now = createTestDate();
    const periodStart = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const periodEnd = Temporal.PlainDate.from(now).toString();

    await ensureClientContractLine(clientId, periodStart);

    const serviceId = await createTestService(context, {
      service_name: 'Manual Allocation Service',
      billing_method: 'fixed',
      default_rate: 9000,
      tax_region: 'US-NY'
    });

    const billingCycleId = await createBillingCycle(clientId, periodStart, periodEnd);

    const charges: IBillingCharge[] = [
      {
        tenant: context.tenantId,
        type: 'usage',
        serviceId,
        serviceName: 'Manual Allocation Service',
        quantity: 1,
        rate: 9000,
        total: 9000,
        tax_amount: 0,
        tax_rate: 0,
        tax_region: 'US-NY',
        is_taxable: true,
        usageId: uuidv4(),
        servicePeriodStart: periodStart,
        servicePeriodEnd: periodEnd,
        billingTiming: 'arrears'
      }
    ];

    const prepaymentInvoice = await createPrepaymentInvoice(clientId, 4000);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const { invoiceId } = await generateInvoiceFromChargesForClient(
      clientId,
      billingCycleId,
      charges
    );

    await applyCreditToInvoice(clientId, invoiceId, 3000);

    const invoiceAfterManualApply = await context.db('invoices')
      .where({ invoice_id: invoiceId })
      .first();

    expect(Number(invoiceAfterManualApply.credit_applied)).toBe(3000);
    expect(Number(invoiceAfterManualApply.total_amount)).toBeGreaterThan(0);

    const remainingCredit = await ClientContractLine.getClientCredit(clientId);
    expect(remainingCredit).toBe(1000);
  });
});
