import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { createPrepaymentInvoice, applyCreditToInvoice } from 'server/src/lib/actions/creditActions';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import {
  createTestService,
  createFixedPlanAssignment,
  addServiceToFixedPlan,
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import ClientBillingPlan from 'server/src/lib/models/clientBilling';
import { createTestDate } from '../../../../../test-utils/dateUtils';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { runWithTenant } from 'server/src/lib/db';
import { createClient } from '../../../../../test-utils/testDataFactory';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

const currentUserRef: { user: any } = { user: null };

const runInTenant = async <T>(fn: () => Promise<T>) => {
  const tenant = context?.tenantId ?? mockedTenantId;
  return runWithTenant(tenant, fn);
};

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

vi.mock('@alga-psa/shared/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
  };
});

vi.mock('@shared/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@shared/core/logger', () => {
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

vi.mock('server/src/lib/eventBus', () => {
  const publish = vi.fn(async () => undefined);
  const subscribe = vi.fn(async () => undefined);
  const initialize = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  return {
    getEventBus: () => ({ publish, subscribe, initialize, close })
  };
});

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve(currentUserRef.user))
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

vi.setConfig({
  testTimeout: 120000,
  hookTimeout: 120000
});

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

async function createManualInvoice(
  clientId: string,
  items: Array<{
    description: string;
    unitPrice: number;
    netAmount: number;
    taxAmount?: number;
    taxRate?: number;
    totalPrice?: number;
    quantity?: number;
    isDiscount?: boolean;
    isTaxable?: boolean;
  }>,
  options: {
    invoiceNumber?: string;
    invoiceDate?: string;
    dueDate?: string;
    billingCycleId?: string | null;
  } = {}
) {
  const invoiceId = uuidv4();
  const now = new Date();
  const invoiceDate = options.invoiceDate ?? now.toISOString();
  const dueDate = options.dueDate ?? invoiceDate;

  const subtotal = items.reduce((sum, item) => sum + item.netAmount, 0);
  const tax = items.reduce((sum, item) => sum + (item.taxAmount ?? 0), 0);
  const total = subtotal + tax;

  await context.db('invoices').insert({
    invoice_id: invoiceId,
    tenant: context.tenantId,
    client_id: clientId,
    invoice_number: options.invoiceNumber ?? `MAN-${invoiceId.slice(0, 8)}`,
    status: 'draft',
    invoice_date: invoiceDate,
    due_date: dueDate,
    subtotal,
    tax,
    total_amount: total,
    credit_applied: 0,
    created_at: invoiceDate,
    updated_at: invoiceDate,
    billing_cycle_id: options.billingCycleId ?? null,
    is_manual: true
  });

  if (items.length) {
    await context.db('invoice_items').insert(
      items.map((item) => ({
        item_id: uuidv4(),
        invoice_id: invoiceId,
        tenant: context.tenantId,
        description: item.description,
        quantity: item.quantity ?? 1,
        unit_price: item.unitPrice,
        net_amount: item.netAmount,
        tax_amount: item.taxAmount ?? 0,
        tax_rate: item.taxRate ?? 0,
        total_price: item.totalPrice ?? item.netAmount + (item.taxAmount ?? 0),
        is_discount: item.isDiscount ?? false,
        is_manual: true,
        is_taxable: item.isTaxable ?? false
      }))
    );
  }

  return { invoiceId, subtotal, tax, total };
}

describe('Credit Application Tests', () => {
  async function setupDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 10.0
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  async function ensureClientBillingSettings(clientId: string, overrides: Record<string, unknown> = {}) {
    await context.db('client_billing_settings')
      .where({ client_id: clientId, tenant: context.tenantId })
      .del();

    await context.db('client_billing_settings').insert({
      client_id: clientId,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides
    });

    return context.db('client_billing_settings')
      .where({ client_id: clientId, tenant: context.tenantId })
      .first();
  }

  async function createClientFixedPlan(
    serviceId: string,
    clientId: string,
    options: Parameters<typeof createFixedPlanAssignment>[2] = {}
  ) {
    const originalClientId = context.clientId;
    context.clientId = clientId;
    try {
      const { planId, clientBillingPlanId } = await createFixedPlanAssignment(context, serviceId, options);
      await context.db('client_billing_plans')
        .where({ client_billing_plan_id: clientBillingPlanId, tenant: context.tenantId })
        .update({ client_id: clientId });
      return { planId, clientBillingPlanId };
    } finally {
      context.clientId = originalClientId;
    }
  }

  async function setupFixedPlanForClient(
    clientId: string,
    serviceConfigs: Array<{ serviceId: string; baseRateCents: number; quantity?: number }>,
    options: { planName?: string; billingFrequency?: string; startDate?: string } = {}
  ) {
    if (!serviceConfigs.length) {
      throw new Error('At least one service configuration is required');
    }

    const [primary, ...additional] = serviceConfigs;

    const { planId } = await createClientFixedPlan(primary.serviceId, clientId, {
      planName: options.planName,
      billingFrequency: options.billingFrequency,
      baseRateCents: primary.baseRateCents,
      quantity: primary.quantity ?? 1,
      startDate: options.startDate
    });

    for (const config of additional) {
      await addServiceToFixedPlan(context, planId, config.serviceId, {
        quantity: config.quantity ?? 1,
        detailBaseRateCents: config.baseRateCents
      });
    }

    return planId;
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'transactions',
        'credit_tracking',
        'credit_allocations',
        'client_billing_cycles',
        'client_billing_plans',
        'plan_service_configuration',
        'plan_service_fixed_config',
        'service_catalog',
        'billing_plan_fixed_config',
        'billing_plans',
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
    currentUserRef.user = mockContext.user;

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
    currentUserRef.user = mockContext.user;
    await setupDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  describe('Credit Application Scenarios', () => {
    it('should correctly apply credit when available credit is less than the invoice total', async () => {
      // Use the context's client instead of creating a new one
      const client_id = context.clientId;

      // Set up client billing settings
      const billingSettings = await ensureClientBillingSettings(client_id);
      expect(billingSettings).toBeTruthy();

      // Create a service using modern helper
      const serviceId = await createTestService(context, {
        service_name: 'Premium Service',
        billing_method: 'fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY'
      });

      // Create billing plan and assign service using modern helper
      const { planId } = await createFixedPlanAssignment(context, serviceId, {
        planName: 'Test Plan',
        billingFrequency: 'monthly',
        baseRateCents: 10000, // $100.00
        quantity: 1,
        startDate: '2025-01-01'
      });

      // Create a billing cycle
      const now = createTestDate();
      const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
      const endDate = Temporal.PlainDate.from(now).toString();
      
      const billingCycleId = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        period_start_date: startDate,
        period_end_date: endDate,
        effective_date: startDate
      }, 'billing_cycle_id');

      // Step 1: Create prepayment invoice with credit amount less than what will be needed
      const prepaymentAmount = 5000; // $50.00 credit
      const prepaymentInvoice = await createPrepaymentInvoice(client_id, prepaymentAmount);
      
      // Step 2: Finalize the prepayment invoice - prepayment invoices don't need a billing cycle
      await finalizeInvoice(prepaymentInvoice.invoice_id);

      // Step 3: Verify initial credit balance
      const initialCredit = await ClientBillingPlan.getClientCredit(client_id);
      expect(initialCredit).toBe(prepaymentAmount);

      // Log credit balance before generating invoice
      console.log('Credit balance before generating invoice:', initialCredit);

      // Step 5: Generate an automatic invoice using the billing cycle
      const invoice = await generateInvoice(billingCycleId);

      if (!invoice) {
        throw new Error('Failed to generate invoice');
      }

      // Log invoice details
      console.log('Generated invoice:', {
        invoice_id: invoice.invoice_id,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total_amount: invoice.total_amount,
        credit_applied: invoice.credit_applied
      });

      // Log credit balance after generating invoice
      const creditAfterGeneration = await ClientBillingPlan.getClientCredit(client_id);
      console.log('Credit balance after generating invoice:', creditAfterGeneration);

      // Step 6: Finalize the manual invoice to apply credit
      await finalizeInvoice(invoice.invoice_id);

      // Step 7: Get the updated invoice to verify credit application
      const updatedInvoice = await context.db('invoices')
        .where({ invoice_id: invoice.invoice_id })
        .first();

      const totals = parseInvoiceTotals(updatedInvoice);
      expect(totals.creditApplied).toBe(prepaymentAmount);
      expect(totals.totalAmount).toBe(totals.totalBeforeCredit - prepaymentAmount);

      // Verify credit balance is now zero
      const finalCredit = await ClientBillingPlan.getClientCredit(client_id);
      expect(finalCredit).toBe(0);

      // Verify credit application transaction
      const creditTransaction = await context.db('transactions')
        .where({
          client_id: client_id,
          invoice_id: invoice.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditTransaction).toBeTruthy();
      expect(parseFloat(creditTransaction.amount)).toBe(-prepaymentAmount);
      expect(creditTransaction.description).toContain('Applied credit to invoice');
    });
  });

  it('should correctly apply credit when available credit exceeds the invoice total', async () => {
    // Create test client
    const client_id = await createClient(
      context.db,
      context.tenantId,
      'Excess Credit Test Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    const billingSettings = await ensureClientBillingSettings(client_id);
    expect(billingSettings).toBeTruthy();

    // Create NY tax rate
    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 10.0,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY Test Tax'
    });

    await context.db('client_tax_rates')
      .where({ client_id: client_id, tenant: context.tenantId })
      .first();

    // Create a service
    const service = await createTestService(context, {
      service_name: 'Premium Service',
      default_rate: 10000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      billing_method: 'fixed'
    });

    const { planId } = await createClientFixedPlan(service, client_id, {
      planName: 'Test Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      quantity: 1,
      startDate: '2025-01-01'
    });

    // Create a billing cycle
    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();
    
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Step 1: Create prepayment invoice with credit amount GREATER than what will be needed
    const prepaymentAmount = 15000; // $150.00 credit (more than the $110 invoice total)
    const prepaymentInvoice = await runInTenant(() => createPrepaymentInvoice(client_id, prepaymentAmount));
    
    // Step 2: Finalize the prepayment invoice - prepayment invoices don't need a billing cycle
    await runInTenant(() => finalizeInvoice(prepaymentInvoice.invoice_id));
    
    // Step 3: Verify initial credit balance
    const initialCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(initialCredit).toBe(prepaymentAmount);

    // Log credit balance before generating invoice
    console.log('Credit balance before generating invoice:', initialCredit);
    
    // Step 4: Generate an automatic invoice using the billing cycle
    const invoice = await runInTenant(() => generateInvoice(billingCycleId));

    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }

    // Log invoice details
    console.log('Generated invoice:', {
      invoice_id: invoice.invoice_id,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total_amount: invoice.total_amount,
      credit_applied: invoice.credit_applied
    });
    
    // Log credit balance after generating invoice
    const creditAfterGeneration = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    console.log('Credit balance after generating invoice:', creditAfterGeneration);

    // Step 5: Finalize the invoice to apply credit
    await runInTenant(() => finalizeInvoice(invoice.invoice_id));

    // Step 6: Get the updated invoice to verify credit application
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();

    // Step 7: Verify credit application using actual invoice values
    const totalBeforeCredit = Number(updatedInvoice.total_amount) + Number(updatedInvoice.credit_applied);
    const expectedAppliedCredit = Math.min(totalBeforeCredit, prepaymentAmount);
    const expectedRemainingBalance = prepaymentAmount - expectedAppliedCredit;

    expect(Number(updatedInvoice.credit_applied)).toBe(expectedAppliedCredit);
    expect(Number(updatedInvoice.total_amount)).toBe(totalBeforeCredit - expectedAppliedCredit);
    
    // Verify remaining credit balance
    const finalCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(finalCredit).toBe(expectedRemainingBalance);

    // Verify credit application transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-expectedAppliedCredit);
    expect(creditTransaction.description).toContain('Applied credit to invoice');
  });

  it('should validate partial credit application when credit is less than invoice total', async () => {
    // Create test client
    const client_id = await createClient(
      context.db,
      context.tenantId,
      'Partial Credit Test Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    const billingSettings = await ensureClientBillingSettings(client_id);
    expect(billingSettings).toBeTruthy();

    // Create NY tax rate
    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 10.0,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY Test Tax'
    });

    // Create two services with different prices
    const service1 = await createTestService(context, {
      service_name: 'Premium Service',
      default_rate: 10000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      billing_method: 'fixed'
    });

    const service2 = await createTestService(context, {
      service_name: 'Additional Service',
      default_rate: 15000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      billing_method: 'fixed'
    });

    const { planId } = await createClientFixedPlan(service1, client_id, {
      planName: 'Test Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      quantity: 1,
      startDate: '2025-01-01'
    });

    await addServiceToFixedPlan(context, planId, service2, {
      quantity: 1,
      detailBaseRateCents: 15000
    });

    // Create a billing cycle
    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();
    
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Step 1: Create prepayment invoice with credit amount LESS than what will be needed for full payment
    const prepaymentAmount = 10000; // $100.00 credit
    const prepaymentInvoice = await runInTenant(() => createPrepaymentInvoice(client_id, prepaymentAmount));
    
    // Step 2: Finalize the prepayment invoice
    await runInTenant(() => finalizeInvoice(prepaymentInvoice.invoice_id));
    
    // Step 3: Verify initial credit balance
    const initialCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(initialCredit).toBe(prepaymentAmount);

    // Log credit balance before generating invoice
    console.log('Credit balance before generating invoice:', initialCredit);
    
    // Step 4: Generate an automatic invoice using the billing cycle
    // This will include both services ($100 + $150 = $250 + 10% tax = $275)
    const invoice = await runInTenant(() => generateInvoice(billingCycleId));
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Log invoice details
    console.log('Generated invoice:', {
      invoice_id: invoice.invoice_id,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total_amount: invoice.total_amount,
      credit_applied: invoice.credit_applied
    });
    
    // Step 5: Finalize the invoice to apply credit
    await runInTenant(() => finalizeInvoice(invoice.invoice_id));

    // Step 6: Get the updated invoice to verify credit application
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();

    const totalBeforeCredit = Number(updatedInvoice.total_amount) + Number(updatedInvoice.credit_applied);
    const expectedCreditApplied = Math.min(prepaymentAmount, totalBeforeCredit);
    const expectedRemainingTotal = totalBeforeCredit - expectedCreditApplied;

    expect(Number(updatedInvoice.credit_applied)).toBe(expectedCreditApplied);
    expect(Number(updatedInvoice.total_amount)).toBe(expectedRemainingTotal);
    
    // Verify remaining credit balance (should be 0 since all credit was applied)
    const finalCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(finalCredit).toBe(0);

    // Verify credit application transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-expectedCreditApplied);
    expect(creditTransaction.description).toContain('Applied credit to invoice');
  });

  it('should verify credit application after discounts are applied', async () => {
    // Create test client
    const client_id = await createClient(
      context.db,
      context.tenantId,
      'Discount Credit Test Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    const billingSettings = await ensureClientBillingSettings(client_id);
    expect(billingSettings).toBeTruthy();

    // Create NY tax rate
    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 10.0,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY Test Tax'
    });

    // Create a service
    const service = await createTestService(context, {
      service_name: 'Premium Service',
      default_rate: 10000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      billing_method: 'fixed'
    });

    const { planId } = await createClientFixedPlan(service, client_id, {
      planName: 'Test Plan',
      billingFrequency: 'monthly',
      baseRateCents: 10000,
      quantity: 1,
      startDate: '2025-01-01'
    });

    // Create a billing cycle
    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();
    
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Step 1: Create prepayment invoice for credit
    const prepaymentAmount = 5000; // $50.00 credit
    const prepaymentInvoice = await runInTenant(() => createPrepaymentInvoice(client_id, prepaymentAmount));
    
    // Step 2: Finalize the prepayment invoice
    await runInTenant(() => finalizeInvoice(prepaymentInvoice.invoice_id));
    
    // Step 3: Verify initial credit balance
    const initialCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(initialCredit).toBe(prepaymentAmount);

    // Step 4: Generate an automatic invoice using the billing cycle
    const invoice = await runInTenant(() => generateInvoice(billingCycleId));
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    console.log('Generated invoice before discount:', {
      invoice_id: invoice.invoice_id,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total_amount: invoice.total_amount
    });

    // Step 5: Add a discount to the invoice
    const discountAmount = 2000; // $20.00 discount
    await context.db('invoice_items').insert({
      item_id: uuidv4(),
      invoice_id: invoice.invoice_id,
      description: 'Loyalty Discount',
      quantity: 1,
      unit_price: -discountAmount,
      net_amount: -discountAmount,
      tax_amount: 0, // Discounts are not taxable
      tax_rate: 0,
      total_price: -discountAmount,
      is_discount: true, // Mark as discount
      is_taxable: false, // Discounts are not taxable
      is_manual: true,
      tenant: context.tenantId
    });

    // Recalculate invoice totals
    const originalSubtotal = 10000; // $100.00
    const tax = 1000;              // $10.00 (10% of $100)
    const discountedSubtotal = originalSubtotal - discountAmount; // $100 - $20 = $80
    const totalWithDiscount = discountedSubtotal + tax; // $80 + $10 = $90

    // Update the invoice totals after adding the discount
    await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .update({
        subtotal: discountedSubtotal,
        total_amount: totalWithDiscount
      });

    // Get the updated invoice with discount
    const invoiceWithDiscount = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();

    console.log('Invoice after discount, before credit:', {
      invoice_id: invoiceWithDiscount.invoice_id,
      subtotal: invoiceWithDiscount.subtotal,
      tax: invoiceWithDiscount.tax,
      total_amount: invoiceWithDiscount.total_amount
    });
    
    // Step 6: Finalize the invoice to apply credit
    await runInTenant(() => finalizeInvoice(invoice.invoice_id));

    // Step 7: Get the updated invoice to verify credit application
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();

    // Step 8: Verify credit application
    const totals = parseInvoiceTotals(updatedInvoice);
    const totalBeforeCredit = totals.totalAmount + totals.creditApplied;
    const expectedCreditApplied = Math.min(prepaymentAmount, totalBeforeCredit);
    const expectedRemainingTotal = totalBeforeCredit - expectedCreditApplied;

    expect(totals.subtotal).toBe(discountedSubtotal);
    expect(totals.creditApplied).toBe(expectedCreditApplied);
    expect(totals.totalAmount).toBe(expectedRemainingTotal);
    
    // Verify remaining credit balance (should be 0 since all credit was applied)
    const finalCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(finalCredit).toBe(0);

    // Verify credit application transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-expectedCreditApplied);
    expect(creditTransaction.description).toContain('Applied credit to invoice');
  });
  
  it('should create credits from regular invoices with negative totals when they are finalized', async () => {
    // Create test client
    const client_id = await createClient(
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

    const billingSettings = await ensureClientBillingSettings(client_id);
    expect(billingSettings).toBeTruthy();

    // Create NY tax rate
    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 10.0,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY Test Tax'
    });

    const initialCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(initialCredit).toBe(0);

    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    const { invoiceId, total: negativeTotal } = await createManualInvoice(
      client_id,
      [
        { description: 'Credit Service A', unitPrice: -5000, netAmount: -5000, taxAmount: 0 },
        { description: 'Credit Service B', unitPrice: -7500, netAmount: -7500, taxAmount: 0 }
      ],
      { billingCycleId }
    );

    expect(negativeTotal).toBeLessThan(0);
    const creditAmount = Math.abs(negativeTotal);

    await runInTenant(() => finalizeInvoice(invoiceId));

    const updatedCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(Math.abs(updatedCredit)).toBe(creditAmount);

    // Credit memos carry negative totals but credit_balance persists the available amount as positive
    expect(updatedCredit).toBeGreaterThanOrEqual(0);

    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoiceId,
        type: 'credit_issuance_from_negative_invoice'
      })
      .first();

    if (!creditTransaction) {
      const debugTransactions = await context.db('transactions')
        .where({ client_id: client_id })
        .orderBy('created_at', 'desc');
      console.log('Transactions for client when credit issuance not found:', debugTransactions);
    }

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(creditAmount);
    expect(creditTransaction.description).toContain('Credit issued from negative invoice');

    const finalizedInvoice = await context.db('invoices')
      .where({ invoice_id: invoiceId })
      .first();

    expect(finalizedInvoice.status).toBe('sent');
    expect(finalizedInvoice.finalized_at).toBeTruthy();
  });

  it('should create credits with expiration dates from negative invoices', async () => {
    // Create test client
    const client_id = await createClient(
      context.db,
      context.tenantId,
      'Negative Invoice With Expiration',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    // Create NY tax rate
    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 10.0,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY Test Tax'
    });

    // Set up client billing settings with expiration days
    const billingSettings = await ensureClientBillingSettings(client_id);
    expect(billingSettings).toBeTruthy();

    const billingSettingsWithExpiration = await ensureClientBillingSettings(client_id, {
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1]
    });
    expect(billingSettingsWithExpiration).toBeTruthy();

    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    const { invoiceId, total: negativeTotal } = await createManualInvoice(
      client_id,
      [
        { description: 'Credit Service A', unitPrice: -5000, netAmount: -5000, taxAmount: 0 },
        { description: 'Credit Service B', unitPrice: -7500, netAmount: -7500, taxAmount: 0 }
      ],
      { billingCycleId }
    );

    expect(negativeTotal).toBeLessThan(0);

    await runInTenant(() => finalizeInvoice(invoiceId));

    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoiceId,
        type: 'credit_issuance_from_negative_invoice'
      })
      .first();

    if (!creditTransaction) {
      const debugTransactions = await context.db('transactions')
        .where({ client_id: client_id })
        .orderBy('created_at', 'desc');
      console.log('Transactions for client (default expiration test):', debugTransactions);
    }

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(Math.abs(negativeTotal));
    expect(creditTransaction.expiration_date).toBeTruthy();

    const expirationDate = new Date(creditTransaction.expiration_date);
    const today = new Date();
    const daysDiff = Math.round((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDiff).toBeCloseTo(30, 1);

    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();

    expect(creditTracking).toBeTruthy();
    expect(parseInt(creditTracking.amount.toString())).toEqual(Math.abs(negativeTotal));
    expect(parseInt(creditTracking.remaining_amount.toString())).toEqual(Math.abs(negativeTotal));
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(creditTransaction.expiration_date));
    expect(creditTracking.is_expired).toBe(false);
  });

  it('should use default billing settings for credit expiration when client settings are not available', async () => {
    // Create test client
    const client_id = await createClient(
      context.db,
      context.tenantId,
      'Default Settings Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    await ensureClientBillingSettings(client_id);

    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 10.0,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY Test Tax'
    });

    // Set up default billing settings with expiration days using upsert pattern
    await context.db('default_billing_settings')
      .insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_expiration_days: 60, // Different from client settings to verify it's used
        credit_expiration_notification_days: [14, 7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict('tenant')
      .merge(); // This will update existing records if there's a conflict

    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    const { invoiceId, total: negativeTotal } = await createManualInvoice(
      client_id,
      [
        { description: 'Credit Service A', unitPrice: -5000, netAmount: -5000, taxAmount: 0 }
      ],
      { billingCycleId }
    );

    expect(negativeTotal).toBeLessThan(0);

    await runInTenant(() => finalizeInvoice(invoiceId));

    const expectedCredit = Math.abs(negativeTotal);
    const updatedCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(Math.abs(updatedCredit)).toBe(expectedCredit);
    // Credit memos post negative totals but credit_balance retains the available amount as positive
    expect(updatedCredit).toBeGreaterThan(0);

    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoiceId,
        type: 'credit_issuance_from_negative_invoice'
      })
      .first();
    
    // Verify transaction details
    expect(creditTransaction).toBeTruthy();
    expect(creditTransaction.expiration_date).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(expectedCredit);
    
    // Verify the expiration date is approximately 60 days from now (from default settings)
    const expirationDate = new Date(creditTransaction.expiration_date);
    const today = new Date();
    const daysDiff = Math.round((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    expect(daysDiff).toBeCloseTo(60, 1); // Allow for small time differences during test execution
    
    // Step 4: Verify credit tracking entry was created with same expiration date
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(creditTracking).toBeTruthy();
    expect(parseInt(creditTracking.amount.toString())).toEqual(expectedCredit);
    expect(parseInt(creditTracking.remaining_amount.toString())).toEqual(expectedCredit);
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(creditTransaction.expiration_date));
  });

  it('should prioritize credits by expiration date when applying to invoices', async () => {
    // Create test client
    const client_id = await createClient(
      context.db,
      context.tenantId,
      'Credit Prioritization Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    await ensureClientBillingSettings(client_id);

    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 10.0,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY Test Tax'
    });

    // Create a service for the invoice
    const service = await createTestService(context, {
      service_name: 'Standard Service',
      default_rate: 20000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      billing_method: 'fixed'
    });

    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const planId = await setupFixedPlanForClient(
      client_id,
      [{ serviceId: service, baseRateCents: 20000 }],
      {
        planName: 'Standard Plan',
        billingFrequency: 'monthly',
        startDate
      }
    );
    
    const billingCycleId = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Link plan to client
    await context.db('client_billing_plans').insert({
      client_billing_plan_id: uuidv4(),
      client_id: client_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Step 1: Create three credit transactions with different expiration dates
    const today = new Date();
    
    // Credit 1: Expires in 30 days (should be used first)
    const expDate1 = new Date(today);
    expDate1.setDate(today.getDate() + 30);
    const expirationDate1 = expDate1.toISOString();
    
    // Credit 2: Expires in 60 days (should be used second)
    const expDate2 = new Date(today);
    expDate2.setDate(today.getDate() + 60);
    const expirationDate2 = expDate2.toISOString();
    
    // Credit 3: No expiration date (should be used last)
    const expirationDate3 = null;
    
    // Create credit transactions and tracking entries
    const transactionId1 = uuidv4();
    const transactionId2 = uuidv4();
    const transactionId3 = uuidv4();
    
    // Create transactions
    await context.db('transactions').insert([
      {
        transaction_id: transactionId1,
        client_id: client_id,
        amount: 5000, // $50.00
        type: 'credit_issuance',
        status: 'completed',
        description: 'Credit 1 - Expires in 30 days',
        created_at: new Date().toISOString(),
        balance_after: 5000,
        tenant: context.tenantId,
        expiration_date: expirationDate1
      },
      {
        transaction_id: transactionId2,
        client_id: client_id,
        amount: 7000, // $70.00
        type: 'credit_issuance',
        status: 'completed',
        description: 'Credit 2 - Expires in 60 days',
        created_at: new Date().toISOString(),
        balance_after: 12000,
        tenant: context.tenantId,
        expiration_date: expirationDate2
      },
      {
        transaction_id: transactionId3,
        client_id: client_id,
        amount: 8000, // $80.00
        type: 'credit_issuance',
        status: 'completed',
        description: 'Credit 3 - No expiration',
        created_at: new Date().toISOString(),
        balance_after: 20000,
        tenant: context.tenantId,
        expiration_date: expirationDate3
      }
    ]);
    
    // Create credit tracking entries
    await context.db('credit_tracking').insert([
      {
        credit_id: uuidv4(),
        tenant: context.tenantId,
        client_id: client_id,
        transaction_id: transactionId1,
        amount: 5000,
        remaining_amount: 5000,
        created_at: new Date().toISOString(),
        expiration_date: expirationDate1,
        is_expired: false,
        updated_at: new Date().toISOString()
      },
      {
        credit_id: uuidv4(),
        tenant: context.tenantId,
        client_id: client_id,
        transaction_id: transactionId2,
        amount: 7000,
        remaining_amount: 7000,
        created_at: new Date().toISOString(),
        expiration_date: expirationDate2,
        is_expired: false,
        updated_at: new Date().toISOString()
      },
      {
        credit_id: uuidv4(),
        tenant: context.tenantId,
        client_id: client_id,
        transaction_id: transactionId3,
        amount: 8000,
        remaining_amount: 8000,
        created_at: new Date().toISOString(),
        expiration_date: expirationDate3,
        is_expired: false,
        updated_at: new Date().toISOString()
      }
    ]);
    
    // Update client credit balance
    await context.db('clients')
      .where({ client_id: client_id, tenant: context.tenantId })
      .update({ credit_balance: 20000 });
    
    // Step 2: Generate an invoice
    const invoice = await runInTenant(() => generateInvoice(billingCycleId));
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Step 3: Apply credit to the invoice (should use credits in order of expiration date)
    await runInTenant(() => applyCreditToInvoice(client_id, invoice.invoice_id, 15000)); // Apply $150 of credit
    
    // Step 4: Verify credit application
    // Get updated credit tracking entries
    const updatedCreditEntries = await context.db('credit_tracking')
      .where({ client_id: client_id, tenant: context.tenantId })
      .orderBy('expiration_date', 'asc');
    
    // Credit 1 (expires in 30 days) should be fully used
    expect(Number(updatedCreditEntries[0].remaining_amount)).toBe(0);
    
    // Credit 2 (expires in 60 days) should be partially used (7000 - (15000 - 5000) = 0)
    expect(Number(updatedCreditEntries[1].remaining_amount)).toBe(0);
    
    // Credit 3 (no expiration) should be partially used (8000 - (15000 - 5000 - 7000) = 5000)
    expect(Number(updatedCreditEntries[2].remaining_amount)).toBe(5000);
    
    // Verify the credit application transaction
    const creditApplicationTx = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    expect(creditApplicationTx).toBeTruthy();
    expect(parseFloat(creditApplicationTx.amount)).toBe(-15000);
    
    // Verify the metadata contains the applied credits
    expect(creditApplicationTx.metadata).toBeTruthy();
    const metadata = typeof creditApplicationTx.metadata === 'string'
      ? JSON.parse(creditApplicationTx.metadata)
      : creditApplicationTx.metadata;
    
    expect(metadata.applied_credits).toBeTruthy();
    expect(metadata.applied_credits.length).toBe(3);
    
    // Verify the applied credits are in the correct order
    expect(metadata.applied_credits[0].transactionId).toBe(transactionId1);
    expect(metadata.applied_credits[1].transactionId).toBe(transactionId2);
    expect(metadata.applied_credits[2].transactionId).toBe(transactionId3);
    
    // Verify the amounts applied from each credit
    expect(metadata.applied_credits[0].amount).toBe(5000);
    expect(metadata.applied_credits[1].amount).toBe(7000);
    expect(metadata.applied_credits[2].amount).toBe(3000);
    
    // Verify the invoice was updated correctly
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id, tenant: context.tenantId })
      .first();
    
    expect(updatedInvoice.credit_applied).toBe(15000);
    
    // Verify the client credit balance was updated
    const updatedClient = await context.db('clients')
      .where({ client_id: client_id, tenant: context.tenantId })
      .first();
    
    expect(updatedClient.credit_balance).toBe(5000);
  });

  it('should correctly apply partial credit across multiple invoices', async () => {
    // Create test client
    const client_id = await createClient(
      context.db,
      context.tenantId,
      'Multiple Invoice Credit Client',
      {
        billing_cycle: 'monthly',
        region_code: 'US-NY',
        is_tax_exempt: false,
        credit_balance: 0
      }
    );

    await ensureClientBillingSettings(client_id);

    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 10.0,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY Test Tax'
    });

    // Create a single service for all invoices
    const service = await createTestService(context, {
      service_name: 'Standard Service',
      default_rate: 10000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      billing_method: 'fixed'
    });

    const now = createTestDate();
    
    // First billing cycle (3 months ago)
    const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 3 }).toString();
    const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
    
    const planId = await setupFixedPlanForClient(
      client_id,
      [{ serviceId: service, baseRateCents: 10000 }],
      {
        planName: 'Standard Plan',
        billingFrequency: 'monthly',
        startDate: startDate1
      }
    );

    const billingCycleId1 = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate1,
      period_end_date: endDate1,
      effective_date: startDate1
    }, 'billing_cycle_id');

    // Second billing cycle (2 months ago)
    const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
    const endDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    
    const billingCycleId2 = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate2,
      period_end_date: endDate2,
      effective_date: startDate2
    }, 'billing_cycle_id');

    // Third billing cycle (1 month ago)
    const startDate3 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate3 = Temporal.PlainDate.from(now).toString();
    
    const billingCycleId3 = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate3,
      period_end_date: endDate3,
      effective_date: startDate3
    }, 'billing_cycle_id');

    // Step 1: Create prepayment invoice with credit amount that will cover multiple invoices
    const prepaymentAmount = 20000; // $200.00 credit
    const prepaymentInvoice = await runInTenant(() => createPrepaymentInvoice(client_id, prepaymentAmount));
    
    // Step 2: Finalize the prepayment invoice to add credit to the client
    await runInTenant(() => finalizeInvoice(prepaymentInvoice.invoice_id));
    
    // Step 3: Verify initial credit balance
    const initialCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(initialCredit).toBe(prepaymentAmount);
    console.log('Initial credit balance:', initialCredit);
    
    // Step 4: Generate invoices for each billing cycle
    const invoice1 = await runInTenant(() => generateInvoice(billingCycleId1)); // Basic service ($50 + $5 tax = $55)
    const invoice2 = await runInTenant(() => generateInvoice(billingCycleId2)); // Standard service ($100 + $10 tax = $110)
    const invoice3 = await runInTenant(() => generateInvoice(billingCycleId3)); // Premium service ($150 + $15 tax = $165)
    
    if (!invoice1 || !invoice2 || !invoice3) {
      throw new Error('Failed to generate one or more invoices');
    }
    
    console.log('Generated invoices:', {
      invoice1: { id: invoice1.invoice_id, total: invoice1.total_amount },
      invoice2: { id: invoice2.invoice_id, total: invoice2.total_amount },
      invoice3: { id: invoice3.invoice_id, total: invoice3.total_amount }
    });
    
    // Step 5: Finalize the first invoice and verify credit application
    await runInTenant(() => finalizeInvoice(invoice1.invoice_id));
    
    // Get the updated invoice
    const updatedInvoice1 = await context.db('invoices')
      .where({ invoice_id: invoice1.invoice_id })
      .first();
    
    const totals1 = parseInvoiceTotals(updatedInvoice1);
    const totalBeforeCredit1 = totals1.totalAmount + totals1.creditApplied;
    const expectedAppliedCredit1 = Math.min(prepaymentAmount, totalBeforeCredit1);
    const expectedRemainingCredit1 = prepaymentAmount - expectedAppliedCredit1;

    expect(totals1.creditApplied).toBe(expectedAppliedCredit1);
    expect(totals1.totalAmount).toBe(totalBeforeCredit1 - expectedAppliedCredit1);

    const creditAfterInvoice1 = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(creditAfterInvoice1).toBe(expectedRemainingCredit1);
    console.log('Credit balance after first invoice:', creditAfterInvoice1);
    
    // Verify credit application transaction for first invoice
    const creditTransaction1 = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoice1.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    expect(creditTransaction1).toBeTruthy();
    expect(parseFloat(creditTransaction1.amount)).toBe(-expectedAppliedCredit1);
    expect(creditTransaction1.description).toContain('Applied credit to invoice');
    
    await runInTenant(() => finalizeInvoice(invoice2.invoice_id));

    const updatedInvoice2 = await context.db('invoices')
      .where({ invoice_id: invoice2.invoice_id })
      .first();

    const totals2 = parseInvoiceTotals(updatedInvoice2);
    const totalBeforeCredit2 = totals2.totalAmount + totals2.creditApplied;
    const expectedAppliedCredit2 = Math.min(expectedRemainingCredit1, totalBeforeCredit2);
    const expectedRemainingCredit2 = expectedRemainingCredit1 - expectedAppliedCredit2;

    expect(totals2.creditApplied).toBe(expectedAppliedCredit2);
    expect(totals2.totalAmount).toBe(totalBeforeCredit2 - expectedAppliedCredit2);

    const creditAfterInvoice2 = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(creditAfterInvoice2).toBe(expectedRemainingCredit2);

    const creditTransaction2 = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoice2.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction2).toBeTruthy();
    expect(parseFloat(creditTransaction2.amount)).toBe(-expectedAppliedCredit2);
    expect(creditTransaction2.description).toContain('Applied credit to invoice');

    await runInTenant(() => finalizeInvoice(invoice3.invoice_id));

    const updatedInvoice3 = await context.db('invoices')
      .where({ invoice_id: invoice3.invoice_id })
      .first();

    const totals3 = parseInvoiceTotals(updatedInvoice3);
    const totalBeforeCredit3 = totals3.totalAmount + totals3.creditApplied;
    const expectedAppliedCredit3 = Math.min(expectedRemainingCredit2, totalBeforeCredit3);
    const expectedRemainingCredit3 = expectedRemainingCredit2 - expectedAppliedCredit3;

    expect(totals3.creditApplied).toBe(expectedAppliedCredit3);
    expect(totals3.totalAmount).toBe(totalBeforeCredit3 - expectedAppliedCredit3);

    const finalCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(finalCredit).toBe(expectedRemainingCredit3);

    const creditTransaction3 = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoice3.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction3).toBeUndefined();

    console.log('Credit application summary:', {
      initialCredit: prepaymentAmount,
      invoice1Applied: expectedAppliedCredit1,
      invoice2Applied: expectedAppliedCredit2,
      invoice3Applied: expectedAppliedCredit3,
      totalApplied: expectedAppliedCredit1 + expectedAppliedCredit2 + expectedAppliedCredit3,
      finalCreditBalance: finalCredit
    });

    expect(expectedAppliedCredit1 + expectedAppliedCredit2 + expectedAppliedCredit3).toBe(prepaymentAmount);
    
    // Verify total credit applied equals initial credit amount
    expect(expectedAppliedCredit1 + expectedAppliedCredit2 + expectedAppliedCredit3).toBe(prepaymentAmount);
  });

  it('should correctly apply partial credit across three invoices with partial credit on the third', async () => {
    // Create test client
    const client_id = await createClient(
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

    await ensureClientBillingSettings(client_id);

    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 10.0,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY Test Tax'
    });

    // Create a single service for all invoices
    const service = await createTestService(context, {
      service_name: 'Standard Service',
      default_rate: 10000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      billing_method: 'fixed'
    });

    const now = createTestDate();

    // First billing cycle (3 months ago)
    const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 3 }).toString();
    const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
    
        const planId = await setupFixedPlanForClient(
      client_id,
      [{ serviceId: service, baseRateCents: 10000 }],
      {
        planName: 'Standard Plan',
        billingFrequency: 'monthly',
        startDate: startDate1
      }
    );

    const billingCycleId1 = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate1,
      period_end_date: endDate1,
      effective_date: startDate1
    }, 'billing_cycle_id');

    // Second billing cycle (2 months ago)
    const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
    const endDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    
    const billingCycleId2 = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate2,
      period_end_date: endDate2,
      effective_date: startDate2
    }, 'billing_cycle_id');

    // Third billing cycle (1 month ago)
    const startDate3 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate3 = Temporal.PlainDate.from(now).toString();
    
    const billingCycleId3 = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      period_start_date: startDate3,
      period_end_date: endDate3,
      effective_date: startDate3
    }, 'billing_cycle_id');

    // Step 1: Create prepayment invoice with credit amount that will cover multiple invoices
    // and partially cover the third invoice
    const prepaymentAmount = 25000; // $250.00 credit (enough for 2 full invoices + partial third)
    const prepaymentInvoice = await runInTenant(() => createPrepaymentInvoice(client_id, prepaymentAmount));
    
    // Step 2: Finalize the prepayment invoice to add credit to the client
    await runInTenant(() => finalizeInvoice(prepaymentInvoice.invoice_id));
    
    // Step 3: Verify initial credit balance
    const initialCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(initialCredit).toBe(prepaymentAmount);
    console.log('Initial credit balance:', initialCredit);
    
    // Step 4: Generate invoices for each billing cycle
    const invoice1 = await runInTenant(() => generateInvoice(billingCycleId1));
    const invoice2 = await runInTenant(() => generateInvoice(billingCycleId2));
    const invoice3 = await runInTenant(() => generateInvoice(billingCycleId3));
    
    if (!invoice1 || !invoice2 || !invoice3) {
      throw new Error('Failed to generate one or more invoices');
    }
    
    console.log('Generated invoices:', {
      invoice1: { id: invoice1.invoice_id, total: invoice1.total_amount },
      invoice2: { id: invoice2.invoice_id, total: invoice2.total_amount },
      invoice3: { id: invoice3.invoice_id, total: invoice3.total_amount }
    });
    
    await runInTenant(() => finalizeInvoice(invoice1.invoice_id));

    const updatedInvoice1 = await context.db('invoices')
      .where({ invoice_id: invoice1.invoice_id })
      .first();

    const totals1 = parseInvoiceTotals(updatedInvoice1);
    const totalBeforeCredit1 = totals1.totalAmount + totals1.creditApplied;
    const appliedCredit1 = Math.min(prepaymentAmount, totalBeforeCredit1);
    let remainingCredit = prepaymentAmount - appliedCredit1;

    expect(totals1.creditApplied).toBe(appliedCredit1);
    expect(totals1.totalAmount).toBe(totalBeforeCredit1 - appliedCredit1);

    const creditAfterInvoice1 = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(creditAfterInvoice1).toBe(remainingCredit);

    const creditTransaction1 = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoice1.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction1).toBeTruthy();
    expect(parseFloat(creditTransaction1.amount)).toBe(-appliedCredit1);
    expect(creditTransaction1.description).toContain('Applied credit to invoice');

    await runInTenant(() => finalizeInvoice(invoice2.invoice_id));

    const updatedInvoice2 = await context.db('invoices')
      .where({ invoice_id: invoice2.invoice_id })
      .first();

    const totals2 = parseInvoiceTotals(updatedInvoice2);
    const totalBeforeCredit2 = totals2.totalAmount + totals2.creditApplied;
    const appliedCredit2 = Math.min(remainingCredit, totalBeforeCredit2);
    remainingCredit -= appliedCredit2;

    expect(totals2.creditApplied).toBe(appliedCredit2);
    expect(totals2.totalAmount).toBe(totalBeforeCredit2 - appliedCredit2);

    const creditAfterInvoice2 = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(creditAfterInvoice2).toBe(remainingCredit);

    const creditTransaction2 = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoice2.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction2).toBeTruthy();
    expect(parseFloat(creditTransaction2.amount)).toBe(-appliedCredit2);
    expect(creditTransaction2.description).toContain('Applied credit to invoice');

    await runInTenant(() => finalizeInvoice(invoice3.invoice_id));

    const updatedInvoice3 = await context.db('invoices')
      .where({ invoice_id: invoice3.invoice_id })
      .first();

    const totals3 = parseInvoiceTotals(updatedInvoice3);
    const totalBeforeCredit3 = totals3.totalAmount + totals3.creditApplied;
    const appliedCredit3 = Math.min(remainingCredit, totalBeforeCredit3);
    remainingCredit -= appliedCredit3;

    expect(totals3.creditApplied).toBe(appliedCredit3);
    expect(totals3.totalAmount).toBe(totalBeforeCredit3 - appliedCredit3);

    const finalCredit = await runInTenant(() => ClientBillingPlan.getClientCredit(client_id));
    expect(finalCredit).toBe(remainingCredit);

    const creditTransaction3 = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: invoice3.invoice_id,
        type: 'credit_application'
      })
      .first();

    if (appliedCredit3 > 0) {
      expect(creditTransaction3).toBeTruthy();
      expect(parseFloat(creditTransaction3.amount)).toBe(-appliedCredit3);
      expect(creditTransaction3.description).toContain('Applied credit to invoice');
    } else {
      expect(creditTransaction3).toBeUndefined();
    }

    console.log('Credit application summary:', {
      initialCredit: prepaymentAmount,
      invoice1Applied: appliedCredit1,
      invoice2Applied: appliedCredit2,
      invoice3Applied: appliedCredit3,
      totalApplied: appliedCredit1 + appliedCredit2 + appliedCredit3,
      finalCreditBalance: finalCredit
    });

    expect(appliedCredit1 + appliedCredit2 + appliedCredit3).toBe(prepaymentAmount);
  });
});
