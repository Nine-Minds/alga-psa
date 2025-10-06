import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { createPrepaymentInvoice } from 'server/src/lib/actions/creditActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { TestContext } from '../../../../../test-utils/testContext';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { expectError, expectNotFound } from '../../../../../test-utils/errorUtils';
import { createTestDate, createTestDateISO, dateHelpers } from '../../../../../test-utils/dateUtils';
import {
  createTestService,
  createFixedPlanAssignment,
  setupCompanyTaxConfiguration,
  assignServiceTaxRate,
  createBucketPlanAssignment,
  createBucketUsageRecord
} from '../../../../../test-utils/billingTestHelpers';
import CompanyBillingPlan from 'server/src/lib/models/clientBilling';
import { runWithTenant } from 'server/src/lib/db';

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

vi.mock('@alga-psa/shared/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
  };
});

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

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

// Create test context helpers
const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Prepayment Invoice System', () => {
  let context: TestContext;

  async function configureDefaultTax() {
    await setupCompanyTaxConfiguration(context, {
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
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'transactions',
        'credit_tracking',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'tickets',
        'company_billing_cycles',
        'company_billing_plans',
        'plan_services',
        'plan_service_configuration',
        'plan_service_fixed_config',
        'plan_service_bucket_config',
        'service_catalog',
        'billing_plan_fixed_config',
        'billing_plans',
        'tax_rates',
        'tax_regions',
        'company_tax_settings',
        'company_tax_rates',
        'company_billing_settings'
      ],
      companyName: 'Prepayment Test Company',
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
    context = await resetContext();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    // Configure default tax for the test company
    await configureDefaultTax();
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
        const result = await runWithTenant(context.tenantId, async () => {
          return await createPrepaymentInvoice(context.companyId, prepaymentAmount);
        });
  
        expect(result).toMatchObject({
          invoice_number: expect.stringMatching(/^TIC\d{6}$/),
          subtotal: prepaymentAmount,
          total_amount: prepaymentAmount.toString(),
          status: 'draft'
        });
      });
  
      it('creates a prepayment invoice with expiration date', async () => {
        // Setup company billing settings with expiration days
        await context.db('company_billing_settings').insert({
          company_id: context.companyId,
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
        const result = await runWithTenant(context.tenantId, async () => {
          return await createPrepaymentInvoice(context.companyId, prepaymentAmount);
        });
  
        // Finalize the invoice to create the credit
        await runWithTenant(context.tenantId, async () => {
          return await finalizeInvoice(result.invoice_id);
        });
  
        // Check that the transaction has an expiration date
        const transaction = await context.db('transactions')
          .where({
            company_id: context.companyId,
            invoice_id: result.invoice_id,
            type: 'credit_issuance'
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
        const prepaymentAmount = 100000;
        const manualExpirationDate = new Date();
        manualExpirationDate.setDate(manualExpirationDate.getDate() + 60); // 60 days from now
        const expirationDateString = manualExpirationDate.toISOString();
  
        const result = await runWithTenant(context.tenantId, async () => {
          return await createPrepaymentInvoice(context.companyId, prepaymentAmount, expirationDateString);
        });
  
        // Finalize the invoice to create the credit
        await runWithTenant(context.tenantId, async () => {
          return await finalizeInvoice(result.invoice_id);
        });
  
        // Check that the transaction has the manual expiration date
        const transaction = await context.db('transactions')
          .where({
            company_id: context.companyId,
            invoice_id: result.invoice_id,
            type: 'credit_issuance'
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

    it('rejects invalid company IDs', async () => {
      const invalidCompanyId = uuidv4();
      
      await expectNotFound(
        () => runWithTenant(context.tenantId, async () => {
          return await createPrepaymentInvoice(invalidCompanyId, 100000);
        }),
        'Company'
      );

      const invoices = await context.db('invoices')
        .where({ 
          company_id: invalidCompanyId,
          tenant: context.tenantId
        });
      expect(invoices).toHaveLength(0);

      const transactions = await context.db('transactions')
        .where({ 
          company_id: invalidCompanyId,
          tenant: context.tenantId
        });
      expect(transactions).toHaveLength(0);
    });
  });

  describe('Finalizing Prepayment Invoices', () => {
    it('finalizes a prepayment invoice and creates credit', async () => {
      const prepaymentAmount = 100000;
      const invoice = await runWithTenant(context.tenantId, async () => {
        return await createPrepaymentInvoice(context.companyId, prepaymentAmount);
      });
      
      await runWithTenant(context.tenantId, async () => {
        return await finalizeInvoice(invoice.invoice_id);
      });

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
          company_id: context.companyId,
          invoice_id: invoice.invoice_id,
          type: 'credit_issuance'
        })
        .first();

      expect(creditTransaction).toMatchObject({
        company_id: context.companyId,
        status: 'completed',
        description: expect.stringContaining('Credit issued')
      });
      expect(parseFloat(creditTransaction.amount)).toBe(prepaymentAmount);

      const creditBalance = await runWithTenant(context.tenantId, async () => {
        return await CompanyBillingPlan.getCompanyCredit(context.companyId);
      });
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
      await context.db('company_billing_cycles').insert({
        billing_cycle_id: billingCycleId,
        company_id: context.companyId,
        tenant: context.tenantId,
        billing_cycle: 'monthly',
        period_start_date: startDate.toInstant().toString(),
        period_end_date: dateHelpers.startOf(now, 'month').toInstant().toString(),
        effective_date: startDate.toInstant().toString()
      });

      // Create a service for bucket usage
      const bucketServiceId = await createTestService(context, {
        billing_method: 'time',
        service_name: 'Bucket Service',
        tax_region: 'US-NY'
      });

      // Create bucket configuration tied to the plan
      await createBucketPlanAssignment(context, bucketServiceId, {
        planId,
        planName: 'Test Plan',
        billingFrequency: 'monthly',
        totalHours: 40,
        overageRateCents: 150,
        billingPeriod: 'monthly',
        startDate: startDate.toInstant().toString()
      });

      // Create bucket usage
      await createBucketUsageRecord(context, {
        planId,
        serviceId: bucketServiceId,
        companyId: context.companyId,
        periodStart: startDate.toInstant().toString(),
        periodEnd: dateHelpers.startOf(now, 'month').toInstant().toString(),
        minutesUsed: 45 * 60,
        overageMinutes: 5 * 60
      });
    });

    it('automatically applies available credit when generating an invoice', async () => {
      // Setup prepayment
      const prepaymentAmount = 100000;
      const prepaymentInvoice = await runWithTenant(context.tenantId, async () => {
        return await createPrepaymentInvoice(context.companyId, prepaymentAmount);
      });
      
      await runWithTenant(context.tenantId, async () => {
        return await finalizeInvoice(prepaymentInvoice.invoice_id);
      });

      const initialCredit = await runWithTenant(context.tenantId, async () => {
        return await CompanyBillingPlan.getCompanyCredit(context.companyId);
      });
      expect(parseInt(initialCredit+'')).toBe(prepaymentAmount);

      // Generate billing invoice
      const generatedInvoice = await runWithTenant(context.tenantId, async () => {
        return await generateInvoice(billingCycleId);
      });

      await runWithTenant(context.tenantId, async () => {
        return await finalizeInvoice(generatedInvoice!.invoice_id);
      });

      const updatedInvoice = await context.db('invoices')
        .where({ invoice_id: generatedInvoice!.invoice_id })
        .first();

      expect(updatedInvoice).toBeTruthy();

      const totals = parseInvoiceTotals(updatedInvoice ?? {});

      // Verify credit application after finalization
      expect(totals.totalAmount).toBeLessThan(totals.totalBeforeCredit);
      expect(totals.creditApplied).toBeGreaterThan(0);

      // Verify credit balance update
      const finalCredit = await runWithTenant(context.tenantId, async () => {
        return await CompanyBillingPlan.getCompanyCredit(context.companyId);
      });
      expect(parseInt(finalCredit+'')).toBe(prepaymentAmount - totals.creditApplied);

      // Verify credit transaction
      const creditTransaction = await context.db('transactions')
        .where({
          company_id: context.companyId,
          invoice_id: generatedInvoice!.invoice_id,
          type: 'credit_application'
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
    await setupCompanyTaxConfiguration(context, {
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
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'transactions',
        'credit_tracking',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'tickets',
        'company_billing_cycles',
        'company_billing_plans',
        'plan_services',
        'plan_service_configuration',
        'plan_service_fixed_config',
        'plan_service_bucket_config',
        'service_catalog',
        'billing_plan_fixed_config',
        'billing_plans',
        'tax_rates',
        'tax_regions',
        'company_tax_settings',
        'company_tax_rates',
        'company_billing_settings'
      ],
      companyName: 'Multiple Credits Test Company',
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
    context = await resetContext();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    // Configure default tax for the test company
    await configureDefaultTax();

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

    // Create billing cycles
    billingCycleId1 = uuidv4();
    billingCycleId2 = uuidv4();

    await context.db('company_billing_cycles').insert([
      {
        billing_cycle_id: billingCycleId1,
        company_id: context.companyId,
        tenant: context.tenantId,
        billing_cycle: 'monthly',
        period_start_date: dateHelpers.startOf(now, 'month').toInstant().toString(),
        period_end_date: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month').toInstant().toString(),
        effective_date: startDate.toInstant().toString()
      },
      {
        billing_cycle_id: billingCycleId2,
        company_id: context.companyId,
        tenant: context.tenantId,
        billing_cycle: 'monthly',
        period_start_date: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month').toInstant().toString(),
        period_end_date: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 2 }), 'month').toInstant().toString(),
        effective_date: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month').toInstant().toString()
      }
    ]);

    // Create a service for bucket usage
    const bucketServiceId = await createTestService(context, {
      billing_method: 'time',
      service_name: 'Bucket Service',
      tax_region: 'US-NY'
    });

    // Create bucket configuration tied to the plan
    await createBucketPlanAssignment(context, bucketServiceId, {
      planId,
      planName: 'Test Plan',
      billingFrequency: 'monthly',
      totalHours: 40,
      overageRateCents: 150,
      billingPeriod: 'monthly',
      startDate: startDate.toInstant().toString()
    });

    // Create bucket usage for both billing cycles
    await Promise.all([
      createBucketUsageRecord(context, {
        planId,
        serviceId: bucketServiceId,
        companyId: context.companyId,
        periodStart: dateHelpers.startOf(now, 'month').toInstant().toString(),
        periodEnd: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month').toInstant().toString(),
        minutesUsed: 45 * 60,
        overageMinutes: 5 * 60
      }),
      createBucketUsageRecord(context, {
        planId,
        serviceId: bucketServiceId,
        companyId: context.companyId,
        periodStart: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month').toInstant().toString(),
        periodEnd: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 2 }), 'month').toInstant().toString(),
        minutesUsed: 50 * 60,
        overageMinutes: 10 * 60
      })
    ]);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('applies credit from multiple prepayment invoices to a single invoice', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount1);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(prepaymentInvoice1.invoice_id);
    });

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount2);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(prepaymentInvoice2.invoice_id);
    });

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await runWithTenant(context.tenantId, async () => {
      return await CompanyBillingPlan.getCompanyCredit(context.companyId);
    });
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate a billing invoice that is less than total prepayment
    const invoice = await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(billingCycleId1);
    });

    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(invoice!.invoice_id);
    });

    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice!.invoice_id })
      .first();

    expect(updatedInvoice).toBeTruthy();

    const totals = parseInvoiceTotals(updatedInvoice ?? {});

    // Verify credit application
    expect(totals.totalAmount).toBeLessThan(totals.totalBeforeCredit);
    expect(totals.creditApplied).toBeGreaterThan(0);

    // Verify credit balance update
    const finalCredit = await runWithTenant(context.tenantId, async () => {
      return await CompanyBillingPlan.getCompanyCredit(context.companyId);
    });
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - totals.creditApplied);

    // Verify credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: context.companyId,
        invoice_id: invoice!.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-totals.creditApplied);
  });

  it('distributes credit across multiple invoices', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount1);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(prepaymentInvoice1.invoice_id);
    });

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount2);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(prepaymentInvoice2.invoice_id);
    });

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await runWithTenant(context.tenantId, async () => {
      return await CompanyBillingPlan.getCompanyCredit(context.companyId);
    });
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate multiple billing invoices
    const invoice1 = await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(billingCycleId1);
    });

    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(invoice1!.invoice_id);
    });

    const updatedInvoice1 = await context.db('invoices')
      .where({ invoice_id: invoice1!.invoice_id })
      .first();
    expect(updatedInvoice1).toBeTruthy();
    const totals1 = parseInvoiceTotals(updatedInvoice1 ?? {});

    const invoice2 = await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(billingCycleId2);
    });

    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(invoice2!.invoice_id);
    });

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
    const finalCredit = await runWithTenant(context.tenantId, async () => {
      return await CompanyBillingPlan.getCompanyCredit(context.companyId);
    });
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - totalCreditApplied);
  });

  it('handles cases where credit exceeds billing amounts', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount1);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(prepaymentInvoice1.invoice_id);
    });

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount2);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(prepaymentInvoice2.invoice_id);
    });

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await runWithTenant(context.tenantId, async () => {
      return await CompanyBillingPlan.getCompanyCredit(context.companyId);
    });
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate a billing invoice with a smaller amount
    const invoice = await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(billingCycleId1);
    });

    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(invoice!.invoice_id);
    });

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
    const finalCredit = await runWithTenant(context.tenantId, async () => {
      return await CompanyBillingPlan.getCompanyCredit(context.companyId);
    });
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - creditApplied);
  });

  it('handles cases where credit is insufficient for billing amounts', async () => {
    // Setup a prepayment
    const prepaymentAmount = 1000;
    const prepaymentInvoice = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount);
    });
    
    const finalizedInvoice = await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(prepaymentInvoice.invoice_id);
    });

    // Create credit issuance transaction after invoice is finalized
    await context.db('transactions').insert({
      transaction_id: uuidv4(),
      company_id: context.companyId,
      invoice_id: prepaymentInvoice.invoice_id,
      amount: prepaymentAmount,
      type: 'credit_issuance',
      status: 'completed',
      description: 'Credit issued from prepayment',
      created_at: createTestDateISO(),
      tenant: context.tenantId,
      balance_after: prepaymentAmount
    });

    const initialCredit = await runWithTenant(context.tenantId, async () => {
      return await CompanyBillingPlan.getCompanyCredit(context.companyId);
    });
    expect(parseInt(initialCredit+'')).toBe(prepaymentAmount);

    // Generate a billing invoice with a larger amount
    const invoice = await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(billingCycleId1);
    });

    await runWithTenant(context.tenantId, async () => {
      return await finalizeInvoice(invoice!.invoice_id);
    });

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
    const finalCredit = await runWithTenant(context.tenantId, async () => {
      return await CompanyBillingPlan.getCompanyCredit(context.companyId);
    });
    expect(parseInt(finalCredit+'')).toBe(0);
  });
});
