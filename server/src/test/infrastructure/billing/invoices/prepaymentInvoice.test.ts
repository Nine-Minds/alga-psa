import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { createPrepaymentInvoice, applyCreditToInvoice } from 'server/src/lib/actions/creditActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { expectError, expectNotFound } from '../../../../../test-utils/errorUtils';
import { createTestDate, createTestDateISO, dateHelpers } from '../../../../../test-utils/dateUtils';
import ClientContractLine from 'server/src/lib/models/clientContractLine';
import { BillingEngine } from 'server/src/lib/billing/billingEngine';
import {
  createTestService,
  createFixedPlanAssignment,
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureDefaultBillingSettings,
  ensureClientPlanBundlesTable
} from '../../../../../test-utils/billingTestHelpers';

// Override DB_PORT to connect directly to PostgreSQL instead of pgbouncer
// This is critical for tests that use advisory locks or other features not supported by pgbouncer
process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/shared/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => {
    try {
      return await callback(knex);
    } catch (error) {
      console.error('[Test] withTransaction error', error);
      throw error;
    }
  }),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => {
    try {
      return await callback(existingConnection as any);
    } catch (error) {
      console.error('[Test] withAdminTransaction error', error);
      throw error;
    }
  })
}));

vi.mock('@alga-psa/shared/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/workflow/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/workflow/core')>();
  return {
    ...actual,
    getWorkflowRuntime: vi.fn(() => ({
      enqueueEvent: vi.fn(async () => {})
    }))
  };
});

vi.mock('server/src/lib/eventBus', () => ({
  getEventBus: () => ({
    publish: vi.fn(async () => {})
  })
}));

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('@alga-psa/shared/core', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

vi.mock('@alga-psa/shared/workflow/persistence', () => ({
  WorkflowEventModel: {
    create: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/workflow/streams', () => ({
  getRedisStreamClient: () => ({
    publishEvent: vi.fn(),
  }),
  toStreamEvent: (event: unknown) => event,
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

let numberingSequence = 0;

vi.mock('server/src/lib/services/numberingService', () => ({
  NumberingService: class {
    async getNextNumber(): Promise<string> {
      numberingSequence += 1;
      return `TIC${numberingSequence.toString().padStart(6, '0')}`;
    }
  }
}));

const originalCalculateBilling = BillingEngine.prototype.calculateBilling;
vi.spyOn(BillingEngine.prototype, 'calculateBilling').mockImplementation(async function (...args) {
  const result = await originalCalculateBilling.apply(this, args as any);
  if (result?.error) {
    console.error('[Test] BillingEngine.calculateBilling error', result.error, {
      tenant: (this as any)?.tenant,
      charges: result.charges?.length,
      creditsApplied: result.creditsApplied,
      context: result.context
    });
  }
  return result;
});

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

vi.setConfig({
  testTimeout: 20000,
  hookTimeout: 20000
});

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
    totalBeforeCredit: subtotal + tax
  };
}

async function createManualInvoiceRecord(context: TestContext, amount: number): Promise<string> {
  const invoiceId = uuidv4();
  const timestamp = new Date().toISOString();

  await context.db('invoices').insert({
    invoice_id: invoiceId,
    tenant: context.tenantId,
    client_id: context.clientId,
    invoice_number: `MAN-${invoiceId.slice(0, 8)}`,
    status: 'sent',
    invoice_date: timestamp,
    due_date: timestamp,
    subtotal: amount,
    tax: 0,
    total_amount: amount,
    credit_applied: 0,
    created_at: timestamp,
    updated_at: timestamp,
    billing_cycle_id: null,
    is_manual: true
  });

  return invoiceId;
}

// Create test context helpers
const { beforeAll: setupContext, beforeEach: resetContext, afterEach: rollbackContext, afterAll: cleanupContext } = TestContext.createHelpers();

describe('Prepayment Invoice System', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: false,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'transactions',
        'credit_tracking',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'tickets',
        'client_billing_cycles',
        'client_billing_plans',
        'plan_services',
        'plan_service_configuration',
        'plan_service_fixed_config',
        'plan_service_bucket_config',
        'service_catalog',
        'billing_plan_fixed_config',
        'billing_plans',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'client_billing_settings'
      ],
      clientName: 'Prepayment Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureDefaultTax();
    await ensureDefaultBillingSettings(context);
    await ensureDefaultBillingSettings(context);
  }, 120000);

  beforeEach(async () => {
    numberingSequence = 0;
    context = await resetContext();
    context.db.on('query-error', (error, obj) => {
      console.error('[Test][MultiCredits] query-error', error?.message, obj?.sql);
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    // Configure default tax for the test client
    await configureDefaultTax();
    await ensureDefaultBillingSettings(context);
    await ensureClientPlanBundlesTable(context);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  describe('Creating Prepayment Invoices', () => {
      it('creates a prepayment invoice with correct details', async () => {
        const prepaymentAmount = 100000;
      const result = await createPrepaymentInvoice(context.clientId, prepaymentAmount);
  
        expect(result).toMatchObject({
          invoice_number: expect.stringMatching(/^TIC\d{6}$/),
          subtotal: prepaymentAmount,
          total_amount: prepaymentAmount.toString(),
          status: 'draft'
        });
      });
  
      it('creates a prepayment invoice with expiration date', async () => {
        // Setup client billing settings with expiration days
        await context.db('client_billing_settings').insert({
          client_id: context.clientId,
          tenant: context.tenantId,
          zero_dollar_invoice_handling: 'normal',
          suppress_zero_dollar_invoices: false,
          enable_credit_expiration: true,
          credit_expiration_days: 30,
          credit_expiration_notification_days: [7, 1],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
  
        const prepaymentAmount = 100000;
        const result = await createPrepaymentInvoice(context.clientId, prepaymentAmount);
  
        // Finalize the invoice to create the credit
        await finalizeInvoice(result.invoice_id);
  
        // Check that the transaction has an expiration date
        const transaction = await context.db('transactions')
          .where({
            client_id: context.clientId,
            invoice_id: result.invoice_id,
            type: 'credit_issuance',
            tenant: context.tenantId
          })
          .first();
  
        expect(transaction).toBeTruthy();
        expect(transaction.expiration_date).toBeTruthy();
        
        // Verify the expiration date is approximately 30 days from now
        const expirationDate = new Date(transaction.expiration_date);
        const today = new Date();
        const daysDiff = Math.round((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        expect(daysDiff).toBeCloseTo(30, 1); // Allow for small time differences during test execution
  
        // Check that the credit tracking entry has the same expiration date
        const creditTracking = await context.db('credit_tracking')
          .where({
            transaction_id: transaction.transaction_id,
            tenant: context.tenantId
          })
          .first();
  
        expect(creditTracking).toBeTruthy();
        // Compare dates by converting to ISO strings (Date objects are different instances)
        expect(new Date(creditTracking.expiration_date).toISOString()).toBe(new Date(transaction.expiration_date).toISOString());
        expect(creditTracking.is_expired).toBe(false);
      });
  
      it('creates a prepayment invoice with manual expiration date', async () => {
        await context.db('client_billing_settings').insert({
          client_id: context.clientId,
          tenant: context.tenantId,
          zero_dollar_invoice_handling: 'normal',
          suppress_zero_dollar_invoices: false,
          enable_credit_expiration: true,
          credit_expiration_days: 30,
          credit_expiration_notification_days: [7, 1],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

        const prepaymentAmount = 100000;
        const manualExpirationDate = new Date();
        manualExpirationDate.setDate(manualExpirationDate.getDate() + 60); // 60 days from now
        const expirationDateString = manualExpirationDate.toISOString();

        const result = await createPrepaymentInvoice(context.clientId, prepaymentAmount, expirationDateString);
  
        // Finalize the invoice to create the credit
        await finalizeInvoice(result.invoice_id);
  
        // Check that the transaction has the manual expiration date
        const transaction = await context.db('transactions')
          .where({
            client_id: context.clientId,
            invoice_id: result.invoice_id,
            type: 'credit_issuance',
            tenant: context.tenantId
          })
          .first();
  
        expect(transaction).toBeTruthy();
        // Convert both to ISO strings for comparison (database may return Date object)
        const actualExpiration = new Date(transaction.expiration_date).toISOString();
        expect(actualExpiration).toBe(expirationDateString);
  
        // Check that the credit tracking entry has the same expiration date
        const creditTracking = await context.db('credit_tracking')
          .where({
            transaction_id: transaction.transaction_id,
            tenant: context.tenantId
          })
          .first();
  
        expect(creditTracking).toBeTruthy();
        // Compare dates by converting to ISO string (database may return Date object)
        expect(new Date(creditTracking.expiration_date).toISOString()).toBe(expirationDateString);
      });

    it('rejects invalid client IDs', async () => {
      const invalidClientId = uuidv4();
      
      await expectNotFound(
        () => createPrepaymentInvoice(invalidClientId, 100000),
        'Client'
      );

      const invoices = await context.db('invoices')
        .where({ 
          client_id: invalidClientId,
          tenant: context.tenantId
        });
      expect(invoices).toHaveLength(0);

      const transactions = await context.db('transactions')
        .where({ 
          client_id: invalidClientId,
          tenant: context.tenantId
        });
      expect(transactions).toHaveLength(0);
    });
  });

  describe('Finalizing Prepayment Invoices', () => {
    it('finalizes a prepayment invoice and creates credit', async () => {
      const prepaymentAmount = 100000;
      const invoice = await createPrepaymentInvoice(context.clientId, prepaymentAmount);

      await finalizeInvoice(invoice.invoice_id);

      const finalizedInvoiceRecord = await context.db('invoices')
        .where({
          invoice_id: invoice.invoice_id,
          tenant: context.tenantId
        })
        .first();

      expect(finalizedInvoiceRecord).toMatchObject({
        invoice_id: invoice.invoice_id,
        status: 'sent'
      });

      // The system should automatically create the credit transaction when finalizing
      // No need to manually insert a transaction

      const creditTransaction = await context.db('transactions')
        .where({
          client_id: context.clientId,
          invoice_id: invoice.invoice_id,
          type: 'credit_issuance',
          tenant: context.tenantId
        })
        .first();

      expect(creditTransaction).toMatchObject({
        client_id: context.clientId,
        status: 'completed',
        description: expect.stringContaining('Credit issued')
      });
      expect(parseFloat(creditTransaction.amount)).toBe(prepaymentAmount);

      const creditBalance = await ClientContractLine.getClientCredit(context.clientId);
      expect(parseInt(creditBalance+'')).toBe(prepaymentAmount);
    });
  });

  describe('Credit Application in Billing', () => {
    let serviceId: string;
    let planId: string;
    let billingCycleId: string;

    beforeEach(async () => {
      // Setup billing configuration
      serviceId = await createTestService(context, {
        service_name: 'Test Service',
        billing_method: 'fixed',
        default_rate: 1000,
        tax_region: 'US-NY'
      });

      const now = createTestDate();
      const startDate = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month');

      const { planId: createdPlanId } = await createFixedPlanAssignment(context, serviceId, {
        planName: 'Test Plan',
        billingFrequency: 'monthly',
        baseRateCents: 1000,
        startDate: startDate.toInstant().toString()
      });
      planId = createdPlanId;

      // Create billing cycle
      billingCycleId = uuidv4();
      await context.db('client_billing_cycles').insert({
        billing_cycle_id: billingCycleId,
        client_id: context.clientId,
        tenant: context.tenantId,
        billing_cycle: 'monthly',
        period_start_date: startDate.toInstant().toString(),
        period_end_date: dateHelpers.startOf(now, 'month').toInstant().toString(),
        effective_date: startDate.toInstant().toString()
      });

      // Link plan to client
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: planId,
        tenant: context.tenantId,
        start_date: startDate.toInstant().toString(),
        is_active: true
      });
    });

    it('automatically applies available credit when generating an invoice', async () => {
      // Setup prepayment
      const prepaymentAmount = 100000;
      const prepaymentInvoice = await createPrepaymentInvoice(context.clientId, prepaymentAmount);

      await finalizeInvoice(prepaymentInvoice.invoice_id);

      const initialCredit = await ClientContractLine.getClientCredit(context.clientId);
      expect(parseInt(initialCredit+'')).toBe(prepaymentAmount);

      // Generate billing invoice
      const generatedInvoice = await generateInvoice(billingCycleId);

      await finalizeInvoice(generatedInvoice!.invoice_id);

      const updatedInvoice = await context.db('invoices')
        .where({ invoice_id: generatedInvoice!.invoice_id })
        .first();

      expect(updatedInvoice).toBeTruthy();

      const totals = parseInvoiceTotals(updatedInvoice ?? {});

      // Verify credit application after finalization
      expect(totals.totalAmount).toBeLessThan(totals.totalBeforeCredit);
      expect(totals.creditApplied).toBeGreaterThan(0);

      // Verify credit balance update
      const finalCredit = await ClientContractLine.getClientCredit(context.clientId);
      expect(parseInt(finalCredit+'')).toBe(prepaymentAmount - totals.creditApplied);

      // Verify credit transaction
      const creditTransaction = await context.db('transactions')
        .where({
          client_id: context.clientId,
          invoice_id: generatedInvoice!.invoice_id,
          type: 'credit_application',
          tenant: context.tenantId
        })
        .first();

      expect(creditTransaction).toBeTruthy();
      expect(parseFloat(creditTransaction.amount)).toBe(-totals.creditApplied);
    });
  });
});

describe('Multiple Credit Applications', () => {
  let context: TestContext;
  let serviceId: string;
  let planId: string;
  let billingCycleId1: string;
  let billingCycleId2: string;

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: false,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'transactions',
        'credit_tracking',
        'client_billing_settings'
      ],
      clientName: 'Multiple Credits Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureDefaultTax();
  }, 120000);

  beforeEach(async () => {
    numberingSequence = 0;
    context = await resetContext();
    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureDefaultTax();
    await ensureDefaultBillingSettings(context);
    await ensureClientPlanBundlesTable(context);

    serviceId = await createTestService(context, {
      service_name: 'Standard Service',
      billing_method: 'fixed',
      default_rate: 1000,
      tax_region: 'US-NY'
    });
    await assignServiceTaxRate(context, serviceId, 'US-NY', { onlyUnset: true });

    const now = createTestDate();
    const currentPeriodStart = dateHelpers.startOf(now, 'month');
    const previousPeriodStart = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month');
    const twoPeriodsAgoStart = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 2 }), 'month');

    const { contractLineId } = await createFixedPlanAssignment(context, serviceId, {
      planName: 'Standard Plan',
      billingFrequency: 'monthly',
      baseRateCents: 1000,
      detailBaseRateCents: 1000,
      startDate: twoPeriodsAgoStart.toInstant().toString(),
      clientId: context.clientId
    });
    planId = contractLineId;

    billingCycleId1 = uuidv4();
    billingCycleId2 = uuidv4();

    await context.db('client_billing_cycles').insert([
      {
        billing_cycle_id: billingCycleId1,
        client_id: context.clientId,
        tenant: context.tenantId,
        billing_cycle: 'monthly',
        period_start_date: twoPeriodsAgoStart.toInstant().toString(),
        period_end_date: previousPeriodStart.toInstant().toString(),
        effective_date: twoPeriodsAgoStart.toInstant().toString()
      },
      {
        billing_cycle_id: billingCycleId2,
        client_id: context.clientId,
        tenant: context.tenantId,
        billing_cycle: 'monthly',
        period_start_date: previousPeriodStart.toInstant().toString(),
        period_end_date: currentPeriodStart.toInstant().toString(),
        effective_date: previousPeriodStart.toInstant().toString()
      }
    ]);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('applies credit from multiple prepayment invoices to a single invoice', async () => {
    const start = Date.now();
    console.log('[Test][MultiCredits] start');

    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(context.clientId, prepaymentAmount1);
    console.log('[Test][MultiCredits] created prepayment 1', Date.now() - start, 'ms');

    await finalizeInvoice(prepaymentInvoice1.invoice_id);
    console.log('[Test][MultiCredits] finalized prepayment 1', Date.now() - start, 'ms');

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(context.clientId, prepaymentAmount2);
    console.log('[Test][MultiCredits] created prepayment 2', Date.now() - start, 'ms');

    await finalizeInvoice(prepaymentInvoice2.invoice_id);
    console.log('[Test][MultiCredits] finalized prepayment 2', Date.now() - start, 'ms');

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await ClientContractLine.getClientCredit(context.clientId);
    console.log('[Test][MultiCredits] fetched credit', Date.now() - start, 'ms', 'credit=', initialCredit);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    console.log('[Test][MultiCredits] generating invoice');
    let invoice;
    try {
      invoice = await generateInvoice(billingCycleId1);
    } catch (error) {
      console.error('[Test][MultiCredits] generateInvoice failed', error);
      throw error;
    }
    console.log('[Test][MultiCredits] generated invoice', Date.now() - start, 'ms');

    await finalizeInvoice(invoice!.invoice_id);
    console.log('[Test][MultiCredits] finalized invoice', Date.now() - start, 'ms');

    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice!.invoice_id })
      .first();

    expect(updatedInvoice).toBeTruthy();

    const totals = parseInvoiceTotals(updatedInvoice ?? {});

    // Verify credit application
    expect(totals.totalAmount).toBeLessThan(totals.totalBeforeCredit);
    expect(totals.creditApplied).toBeGreaterThan(0);

    // Verify credit balance update
    const finalCredit = await ClientContractLine.getClientCredit(context.clientId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - totals.creditApplied);

    // Verify credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: context.clientId,
        invoice_id: invoice!.invoice_id,
        type: 'credit_application',
        tenant: context.tenantId
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-totals.creditApplied);
  });

  it('distributes credit across multiple invoices', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(context.clientId, prepaymentAmount1);

    await finalizeInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(context.clientId, prepaymentAmount2);

    await finalizeInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await ClientContractLine.getClientCredit(context.clientId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate multiple billing invoices
    let invoice1;
    try {
      invoice1 = await generateInvoice(billingCycleId1);
    } catch (error) {
      console.error('[Test] generateInvoice failed (multi invoice, first cycle)', error);
      throw error;
    }

    await finalizeInvoice(invoice1!.invoice_id);

    const updatedInvoice1 = await context.db('invoices')
      .where({ invoice_id: invoice1!.invoice_id })
      .first();
    expect(updatedInvoice1).toBeTruthy();
    const totals1 = parseInvoiceTotals(updatedInvoice1 ?? {});

    let invoice2;
    try {
      invoice2 = await generateInvoice(billingCycleId2);
    } catch (error) {
      console.error('[Test] generateInvoice failed (multi invoice, second cycle)', error);
      throw error;
    }

    await finalizeInvoice(invoice2!.invoice_id);

    const updatedInvoice2 = await context.db('invoices')
      .where({ invoice_id: invoice2!.invoice_id })
      .first();
    expect(updatedInvoice2).toBeTruthy();
    const totals2 = parseInvoiceTotals(updatedInvoice2 ?? {});

    // Verify credit application on both invoices
    expect(totals1.totalAmount).toBeLessThan(totals1.totalBeforeCredit);
    expect(totals1.creditApplied).toBeGreaterThan(0);
    expect(totals2.totalAmount).toBeLessThan(totals2.totalBeforeCredit);
    expect(totals2.creditApplied).toBeGreaterThan(0);

    // Verify total credit applied
    const totalCreditApplied = totals1.creditApplied + totals2.creditApplied;
    expect(totalCreditApplied).toBeLessThanOrEqual(totalPrepayment);

    // Verify final credit balance
    const finalCredit = await ClientContractLine.getClientCredit(context.clientId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - totalCreditApplied);
  });

  it('handles cases where credit exceeds billing amounts', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(context.clientId, prepaymentAmount1);

    await finalizeInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(context.clientId, prepaymentAmount2);

    await finalizeInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await ClientContractLine.getClientCredit(context.clientId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate a billing invoice with a smaller amount
    let invoice;
    try {
      invoice = await generateInvoice(billingCycleId1);
    } catch (error) {
      console.error('[Test] generateInvoice failed (exceeds billing amounts)', error);
      throw error;
    }

    await finalizeInvoice(invoice!.invoice_id);

    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice!.invoice_id })
      .first();

    expect(updatedInvoice).toBeTruthy();

    const totals = parseInvoiceTotals(updatedInvoice ?? {});

    // Verify credit application
    expect(totals.totalAmount).toBe(0);
    const creditApplied = totals.creditApplied;
    expect(creditApplied).toBeLessThanOrEqual(totalPrepayment);

    // Verify final credit balance
    const finalCredit = await ClientContractLine.getClientCredit(context.clientId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - creditApplied);
  });

  it('handles cases where credit is insufficient for billing amounts', async () => {
    // Setup a prepayment
    const prepaymentAmount = 1000;
    const prepaymentInvoice = await createPrepaymentInvoice(context.clientId, prepaymentAmount);

    await finalizeInvoice(prepaymentInvoice.invoice_id);

    // Create credit issuance transaction after invoice is finalized
    await context.db('transactions').insert({
      transaction_id: uuidv4(),
      client_id: context.clientId,
      invoice_id: prepaymentInvoice.invoice_id,
      amount: prepaymentAmount,
      type: 'credit_issuance',
      status: 'completed',
      description: 'Credit issued from prepayment',
      created_at: createTestDateISO(),
      tenant: context.tenantId,
      balance_after: prepaymentAmount
    });

    const initialCredit = await ClientContractLine.getClientCredit(context.clientId);
    expect(parseInt(initialCredit+'')).toBe(prepaymentAmount);

    // Generate a billing invoice with a larger amount
    let invoice;
    try {
      invoice = await generateInvoice(billingCycleId1);
    } catch (error) {
      console.error('[Test] generateInvoice failed (insufficient credit)', error);
      throw error;
    }

    await finalizeInvoice(invoice!.invoice_id);

    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice!.invoice_id })
      .first();

    expect(updatedInvoice).toBeTruthy();

    const totals = parseInvoiceTotals(updatedInvoice ?? {});

    // Verify credit application
    expect(totals.totalAmount).toBeLessThan(totals.totalBeforeCredit);
    const creditApplied = Math.min(prepaymentAmount, totals.totalBeforeCredit);
    expect(totals.creditApplied).toBe(creditApplied);
    expect(totals.totalAmount).toBe(totals.totalBeforeCredit - creditApplied);

    // Verify final credit balance
    const finalCredit = await ClientContractLine.getClientCredit(context.clientId);
    expect(parseInt(finalCredit+'')).toBe(0);
  });
});
