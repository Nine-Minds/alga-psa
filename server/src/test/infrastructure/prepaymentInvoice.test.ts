import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { createPrepaymentInvoice } from 'server/src/lib/actions/creditActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder } from 'util';
import { TestContext } from '../../../test-utils/testContext';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import { expectError, expectNotFound } from '../../../test-utils/errorUtils';
import { createTestDate, createTestDateISO, dateHelpers } from '../../../test-utils/dateUtils';
import CompanyBillingPlan from 'server/src/lib/models/clientBilling';
import { runWithTenant } from 'server/src/lib/db';
import '../../../test-utils/nextApiMock';

global.TextEncoder = TextEncoder;

// Create test context helpers
const { beforeAll: setupContext, beforeEach: resetContext, afterAll: cleanupContext } = TestContext.createHelpers();

let context: TestContext;

beforeAll(async () => {
  // Initialize test context and set up mocks
  context = await setupContext({
    cleanupTables: [
      'service_catalog',
      'tax_rates',
      'company_tax_settings',
      'transactions',
      'company_billing_cycles',
      'company_billing_plans',
      'bucket_plans',
      'bucket_usage'
    ]
  });
  setupCommonMocks({ tenantId: context.tenantId });
});

beforeEach(async () => {
  await resetContext();
});

afterAll(async () => {
  await cleanupContext();
});

/**
 * Helper to create a test service
 */
async function createTestService(overrides = {}) {
  const serviceId = uuidv4();
  const defaultService = {
    service_id: serviceId,
    tenant: context.tenantId,
    service_name: 'Test Service',
    service_type: 'Fixed',
    default_rate: 1000,
    unit_of_measure: 'each',
    is_taxable: true,
    tax_region: 'US-NY'
  };

  await context.db('service_catalog').insert({ ...defaultService, ...overrides });
  return serviceId;
}

/**
 * Helper to create a test plan
 */
async function createTestPlan(serviceId: string, overrides = {}) {
  const planId = uuidv4();
  const defaultPlan = {
    plan_id: planId,
    tenant: context.tenantId,
    plan_name: 'Test Plan',
    billing_frequency: 'monthly',
    is_custom: false,
    plan_type: 'Fixed'
  };

  await context.db('billing_plans').insert({ ...defaultPlan, ...overrides });
  await context.db('plan_services').insert({
    plan_id: planId,
    service_id: serviceId,
    tenant: context.tenantId,
    quantity: 1
  });

  return planId;
}

/**
 * Helper to set up tax configuration
 */
async function setupTaxConfiguration() {
  const taxRateId = uuidv4();
  await context.db('tax_rates').insert({
    tax_rate_id: taxRateId,
    tenant: context.tenantId,
    region: 'US-NY',
    tax_percentage: 8.875,
    description: 'NY State + City Tax',
    start_date: createTestDateISO()
  });

  await context.db('company_tax_settings').insert({
    company_id: context.companyId,
    tenant: context.tenantId,
    tax_rate_id: taxRateId,
    is_reverse_charge_applicable: false
  });

  return taxRateId;
}

describe('Prepayment Invoice System', () => {
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
          return await generateInvoice(result.invoice_id);
        });
  
        // Check that the transaction has an expiration date
        const transaction = await context.db('transactions')
          .where({
            invoice_id: result.invoice_id,
            tenant: context.tenantId,
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
        expect(creditTracking.expiration_date).toBe(transaction.expiration_date);
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
          return await generateInvoice(result.invoice_id);
        });
  
        // Check that the transaction has the manual expiration date
        const transaction = await context.db('transactions')
          .where({
            invoice_id: result.invoice_id,
            tenant: context.tenantId,
            type: 'credit_issuance'
          })
          .first();
  
        expect(transaction).toBeTruthy();
        expect(transaction.expiration_date).toBe(expirationDateString);
  
        // Check that the credit tracking entry has the same expiration date
        const creditTracking = await context.db('credit_tracking')
          .where({
            transaction_id: transaction.transaction_id,
            tenant: context.tenantId
          })
          .first();
  
        expect(creditTracking).toBeTruthy();
        expect(creditTracking.expiration_date).toBe(expirationDateString);
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
      
      const finalizedInvoice = await runWithTenant(context.tenantId, async () => {
        return await generateInvoice(invoice.invoice_id);
      });

      expect(finalizedInvoice).toMatchObject({
        invoice_id: invoice.invoice_id,
        status: 'sent'
      });

      // The system should automatically create the credit transaction when finalizing
      // No need to manually insert a transaction

      const creditTransaction = await context.db('transactions')
        .where({
          invoice_id: invoice.invoice_id,
          tenant: context.tenantId,
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
      serviceId = await createTestService();
      planId = await createTestPlan(serviceId);
      await setupTaxConfiguration();

      const now = createTestDate();
      const startDate = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month');
      
      // Create billing cycle
      billingCycleId = uuidv4();
      await context.db('company_billing_cycles').insert({
        billing_cycle_id: billingCycleId,
        company_id: context.companyId,
        tenant: context.tenantId,
        billing_cycle: 'monthly',
        period_start_date: startDate,
        period_end_date: dateHelpers.startOf(now, 'month'),
        effective_date: startDate
      });

      // Link plan to company
      await context.db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        tenant: context.tenantId,
        start_date: startDate,
        is_active: true
      });

      // Create a service for bucket usage
      const bucketServiceId = await createTestService({
        service_type: 'Time',
        service_name: 'Bucket Service',
        tax_region: 'US-NY'
      });

      // Create bucket plan
      const bucketPlanId = uuidv4();
      await context.db('bucket_plans').insert({
        bucket_plan_id: bucketPlanId,
        plan_id: planId,
        total_hours: 40,
        billing_period: 'monthly',
        overage_rate: 150,
        tenant: context.tenantId
      });

      // Create bucket usage
      await context.db('bucket_usage').insert({
        usage_id: uuidv4(),
        bucket_plan_id: bucketPlanId,
        company_id: context.companyId,
        period_start: startDate,
        period_end: dateHelpers.startOf(now, 'month'),
        minutes_used: 45,
        overage_minutes: 5,
        service_catalog_id: bucketServiceId,
        tenant: context.tenantId
      });
    });

    it('automatically applies available credit when generating an invoice', async () => {
      // Setup prepayment
      const prepaymentAmount = 100000;
      const prepaymentInvoice = await runWithTenant(context.tenantId, async () => {
        return await createPrepaymentInvoice(context.companyId, prepaymentAmount);
      });
      
      await runWithTenant(context.tenantId, async () => {
        return await generateInvoice(prepaymentInvoice.invoice_id);
      });

      const initialCredit = await runWithTenant(context.tenantId, async () => {
        return await CompanyBillingPlan.getCompanyCredit(context.companyId);
      });
      expect(parseInt(initialCredit+'')).toBe(prepaymentAmount);

      // Generate billing invoice
      const invoice = await runWithTenant(context.tenantId, async () => {
        return await generateInvoice(billingCycleId);
      });

      // Verify credit application
      expect(invoice!.total).toBeLessThan(invoice!.subtotal + invoice!.tax);
      const creditApplied = invoice!.subtotal + invoice!.tax - invoice!.total;
      expect(creditApplied).toBeGreaterThan(0);

      // Verify credit balance update
      const finalCredit = await runWithTenant(context.tenantId, async () => {
        return await CompanyBillingPlan.getCompanyCredit(context.companyId);
      });
      expect(parseInt(finalCredit+'')).toBe(prepaymentAmount - creditApplied);

      // Verify credit transaction
      const creditTransaction = await context.db('transactions')
        .where({
          company_id: context.companyId,
          invoice_id: invoice!.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditTransaction).toBeTruthy();
      expect(parseFloat(creditTransaction.amount)).toBe(-creditApplied);
    });
  });
});

describe('Multiple Credit Applications', () => {
  let serviceId: string;
  let planId: string;
  let billingCycleId1: string;
  let billingCycleId2: string;

  beforeEach(async () => {
    // Setup billing configuration
    serviceId = await createTestService();
    planId = await createTestPlan(serviceId);
    await setupTaxConfiguration();

    const now = createTestDate();
    const startDate = dateHelpers.startOf(dateHelpers.subtractDuration(now, { months: 1 }), 'month');
    
    // Create billing cycles
    billingCycleId1 = uuidv4();
    billingCycleId2 = uuidv4();

    await context.db('company_billing_cycles').insert([
      {
        billing_cycle_id: billingCycleId1,
        company_id: context.companyId,
        tenant: context.tenantId,
        billing_cycle: 'monthly',
        period_start_date: dateHelpers.startOf(now, 'month'),
        period_end_date: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month'),
        effective_date: startDate
      },
      {
        billing_cycle_id: billingCycleId2,
        company_id: context.companyId,
        tenant: context.tenantId,
        billing_cycle: 'monthly',
        period_start_date: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month'),
        period_end_date: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 2 }), 'month'),
        effective_date: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month')
      }
    ]);

    // Link plan to company
    await context.db('company_billing_plans').insert([
      {
        company_billing_plan_id: uuidv4(),
        company_id: context.companyId,
        plan_id: planId,
        tenant: context.tenantId,
        start_date: startDate,
        is_active: true
      }
    ]);

    // Create a service for bucket usage
    const bucketServiceId = await createTestService({
      service_type: 'Time',
      service_name: 'Bucket Service',
      tax_region: 'US-NY'
    });

    // Create bucket plan
    const bucketPlanId = uuidv4();
    await context.db('bucket_plans').insert({
      bucket_plan_id: bucketPlanId,
      plan_id: planId,
      total_hours: 40,
      billing_period: 'monthly',
      overage_rate: 150,
      tenant: context.tenantId
    });

    // Create bucket usage for both billing cycles
    await context.db('bucket_usage').insert([
      {
        usage_id: uuidv4(),
        bucket_plan_id: bucketPlanId,
        company_id: context.companyId,
        period_start: dateHelpers.startOf(now, 'month'),
        period_end: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month'),
        minutes_used: 45,
        overage_minutes: 5,
        service_catalog_id: bucketServiceId,
        tenant: context.tenantId
      },
      {
        usage_id: uuidv4(),
        bucket_plan_id: bucketPlanId,
        company_id: context.companyId,
        period_start: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month'),
        period_end: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 2 }), 'month'),
        minutes_used: 50,
        overage_minutes: 10,
        service_catalog_id: bucketServiceId,
        tenant: context.tenantId
      }
    ]);
  });

  it('applies credit from multiple prepayment invoices to a single invoice', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount1);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(prepaymentInvoice1.invoice_id);
    });

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount2);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(prepaymentInvoice2.invoice_id);
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

    // Verify credit application
    expect(invoice!.total).toBeLessThan(invoice!.subtotal + invoice!.tax);
    const creditApplied = invoice!.subtotal + invoice!.tax - invoice!.total;
    expect(creditApplied).toBeGreaterThan(0);

    // Verify credit balance update
    const finalCredit = await runWithTenant(context.tenantId, async () => {
      return await CompanyBillingPlan.getCompanyCredit(context.companyId);
    });
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - creditApplied);

    // Verify credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: context.companyId,
        invoice_id: invoice!.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-creditApplied);
  });

  it('distributes credit across multiple invoices', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount1);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(prepaymentInvoice1.invoice_id);
    });

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount2);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(prepaymentInvoice2.invoice_id);
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
    
    const invoice2 = await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(billingCycleId2);
    });

    // Verify credit application on invoice1
    expect(invoice1!.total).toBeLessThan(invoice1!.subtotal + invoice1!.tax);
    const creditApplied1 = invoice1!.subtotal + invoice1!.tax - invoice1!.total;
    expect(creditApplied1).toBeGreaterThan(0);

    // Verify credit application on invoice2
    expect(invoice2!.total).toBeLessThan(invoice2!.subtotal + invoice2!.tax);
    const creditApplied2 = invoice2!.subtotal + invoice2!.tax - invoice2!.total;
    expect(creditApplied2).toBeGreaterThan(0);

    // Verify total credit applied
    const totalCreditApplied = creditApplied1 + creditApplied2;
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
      return await generateInvoice(prepaymentInvoice1.invoice_id);
    });

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await runWithTenant(context.tenantId, async () => {
      return await createPrepaymentInvoice(context.companyId, prepaymentAmount2);
    });
    
    await runWithTenant(context.tenantId, async () => {
      return await generateInvoice(prepaymentInvoice2.invoice_id);
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

    // Verify credit application
    expect(invoice!.total).toBe(0);
    const creditApplied = invoice!.subtotal + invoice!.tax;
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
      return await generateInvoice(prepaymentInvoice.invoice_id);
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

    // Verify credit application
    expect(invoice!.total).toBeLessThan(invoice!.subtotal + invoice!.tax);
    const creditApplied = prepaymentAmount;
    expect(invoice!.total).toBe(invoice!.subtotal + invoice!.tax - creditApplied);

    // Verify final credit balance
    const finalCredit = await runWithTenant(context.tenantId, async () => {
      return await CompanyBillingPlan.getCompanyCredit(context.companyId);
    });
    expect(parseInt(finalCredit+'')).toBe(0);
  });
});
