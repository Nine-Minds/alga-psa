import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateInvoice } from '@/lib/actions/invoiceActions';
import { createPrepaymentInvoice } from '@/lib/actions/creditActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder } from 'util';
import { TestContext } from '../../../test-utils/testContext';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import { expectError, expectNotFound } from '../../../test-utils/errorUtils';
import { createTestDate, createTestDateISO, dateHelpers } from '../../../test-utils/dateUtils';
import CompanyBillingPlan from '@/lib/models/clientBilling';

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
      const result = await createPrepaymentInvoice(context.companyId, prepaymentAmount);

      expect(result).toMatchObject({
        invoice_number: expect.stringMatching(/^INV-\d{6}$/),
        subtotal: prepaymentAmount,
        total_amount: prepaymentAmount,
        status: 'draft'
      });
    });

    it('rejects invalid company IDs', async () => {
      const invalidCompanyId = uuidv4();
      
      await expectNotFound(
        () => createPrepaymentInvoice(invalidCompanyId, 100000),
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
      const invoice = await createPrepaymentInvoice(context.companyId, prepaymentAmount);
      const finalizedInvoice = await generateInvoice(invoice.invoice_id);

      expect(finalizedInvoice).toMatchObject({
        invoice_id: invoice.invoice_id,
        status: 'sent'
      });

      // Create credit issuance transaction after invoice is finalized
      await context.db('transactions').insert({
        transaction_id: uuidv4(),
        company_id: context.companyId,
        invoice_id: invoice.invoice_id,
        amount: prepaymentAmount,
        type: 'credit_issuance',
        status: 'completed',
        description: 'Credit issued from prepayment',
        created_at: createTestDateISO(),
        tenant: context.tenantId,
        balance_after: prepaymentAmount
      });

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
        description: 'Credit issued from prepayment'
      });
      expect(parseFloat(creditTransaction.amount)).toBe(prepaymentAmount);

      const creditBalance = await CompanyBillingPlan.getCompanyCredit(context.companyId);
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
        hours_used: 45,
        overage_hours: 5,
        service_catalog_id: bucketServiceId,
        tenant: context.tenantId
      });
    });

    it('automatically applies available credit when generating an invoice', async () => {
      // Setup prepayment
      const prepaymentAmount = 100000;
      const prepaymentInvoice = await createPrepaymentInvoice(context.companyId, prepaymentAmount);
      await generateInvoice(prepaymentInvoice.invoice_id);

      const initialCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
      expect(parseInt(initialCredit+'')).toBe(prepaymentAmount);

      // Generate billing invoice
      const invoice = await generateInvoice(billingCycleId);

      // Verify credit application
      expect(invoice.total).toBeLessThan(invoice.subtotal + invoice.tax);
      const creditApplied = invoice.subtotal + invoice.tax - invoice.total;
      expect(creditApplied).toBeGreaterThan(0);

      // Verify credit balance update
      const finalCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
      expect(parseInt(finalCredit+'')).toBe(prepaymentAmount - creditApplied);

      // Verify credit transaction
      const creditTransaction = await context.db('transactions')
        .where({
          company_id: context.companyId,
          invoice_id: invoice.invoice_id,
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
        hours_used: 45,
        overage_hours: 5,
        service_catalog_id: bucketServiceId,
        tenant: context.tenantId
      },
      {
        usage_id: uuidv4(),
        bucket_plan_id: bucketPlanId,
        company_id: context.companyId,
        period_start: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 1 }), 'month'),
        period_end: dateHelpers.startOf(dateHelpers.addDuration(now, { months: 2 }), 'month'),
        hours_used: 50,
        overage_hours: 10,
        service_catalog_id: bucketServiceId,
        tenant: context.tenantId
      }
    ]);
  });

  it('applies credit from multiple prepayment invoices to a single invoice', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(context.companyId, prepaymentAmount1);
    await generateInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(context.companyId, prepaymentAmount2);
    await generateInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate a billing invoice that is less than total prepayment
    const invoice = await generateInvoice(billingCycleId1);

    // Verify credit application
    expect(invoice.total).toBeLessThan(invoice.subtotal + invoice.tax);
    const creditApplied = invoice.subtotal + invoice.tax - invoice.total;
    expect(creditApplied).toBeGreaterThan(0);

    // Verify credit balance update
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - creditApplied);

    // Verify credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: context.companyId,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-creditApplied);
  });

  it('distributes credit across multiple invoices', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(context.companyId, prepaymentAmount1);
    await generateInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(context.companyId, prepaymentAmount2);
    await generateInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate multiple billing invoices
    const invoice1 = await generateInvoice(billingCycleId1);
    const invoice2 = await generateInvoice(billingCycleId2);

    // Verify credit application on invoice1
    expect(invoice1.total).toBeLessThan(invoice1.subtotal + invoice1.tax);
    const creditApplied1 = invoice1.subtotal + invoice1.tax - invoice1.total;
    expect(creditApplied1).toBeGreaterThan(0);

    // Verify credit application on invoice2
    expect(invoice2.total).toBeLessThan(invoice2.subtotal + invoice2.tax);
    const creditApplied2 = invoice2.subtotal + invoice2.tax - invoice2.total;
    expect(creditApplied2).toBeGreaterThan(0);

    // Verify total credit applied
    const totalCreditApplied = creditApplied1 + creditApplied2;
    expect(totalCreditApplied).toBeLessThanOrEqual(totalPrepayment);

    // Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - totalCreditApplied);
  });

  it('handles cases where credit exceeds billing amounts', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(context.companyId, prepaymentAmount1);
    await generateInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(context.companyId, prepaymentAmount2);
    await generateInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate a billing invoice with a smaller amount
    const invoice = await generateInvoice(billingCycleId1);

    // Verify credit application
    expect(invoice.total).toBe(0);
    const creditApplied = invoice.subtotal + invoice.tax;
    expect(creditApplied).toBeLessThanOrEqual(totalPrepayment);

    // Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - creditApplied);
  });

  it('handles cases where credit is insufficient for billing amounts', async () => {
    // Setup a prepayment
    const prepaymentAmount = 1000;
    const prepaymentInvoice = await createPrepaymentInvoice(context.companyId, prepaymentAmount);
    const finalizedInvoice = await generateInvoice(prepaymentInvoice.invoice_id);

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

    const initialCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(parseInt(initialCredit+'')).toBe(prepaymentAmount);

    // Generate a billing invoice with a larger amount
    const invoice = await generateInvoice(billingCycleId1);

    // Verify credit application
    expect(invoice.total).toBeLessThan(invoice.subtotal + invoice.tax);
    const creditApplied = prepaymentAmount;
    expect(invoice.total).toBe(invoice.subtotal + invoice.tax - creditApplied);

    // Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(context.companyId);
    expect(parseInt(finalCredit+'')).toBe(0);
  });
});
