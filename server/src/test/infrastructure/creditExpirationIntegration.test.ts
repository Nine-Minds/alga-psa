import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { createPrepaymentInvoice, applyCreditToInvoice } from '@/lib/actions/creditActions';
import { finalizeInvoice, generateInvoice } from '@/lib/actions/invoiceActions';
import { createDefaultTaxSettings } from '@/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { expiredCreditsHandler } from '@/lib/jobs/handlers/expiredCreditsHandler';
import { toPlainDate } from '@/lib/utils/dateTimeUtils';

/**
 * Integration tests for credit expiration with other system components.
 * 
 * These tests focus on how credit expiration interacts with other parts of the system:
 * - Handling credits generated from negative invoices
 * - Ensuring expired credits are excluded from credit application
 * - Verifying proper integration with the invoicing and billing systems
 */

describe('Credit Expiration Integration Tests', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'transactions',
        'credit_tracking',
        'company_billing_cycles',
        'company_billing_plans',
        'plan_services',
        'service_catalog',
        'billing_plans',
        'bucket_plans',
        'bucket_usage',
        'tax_rates',
        'company_tax_settings',
        'company_billing_settings',
        'default_billing_settings'
      ],
      companyName: 'Credit Expiration Test Company',
      userType: 'internal'
    });

    // Create default tax settings and billing settings
    await createDefaultTaxSettings(context.company.company_id);
  });

  beforeEach(async () => {
    await testHelpers.beforeEach();
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  it('should validate that credits from negative invoices receive proper expiration dates', async () => {
    // Import the generateInvoice function
    const { generateInvoice } = await import('@/lib/actions/invoiceActions');

    // Create test company without company-specific billing settings
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Negative Invoice Expiration Test',
      billing_cycle: 'monthly',
      company_id: uuidv4(),
      tax_region: 'US-NY',
      is_tax_exempt: false,
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      is_inactive: false
    }, 'company_id');

    // Ensure no company-specific billing settings exist
    await context.db('company_billing_settings')
      .where({ company_id, tenant: context.tenantId })
      .delete();
    
    // Set up default billing settings with specific expiration days
    const defaultExpirationDays = 90; // 90-day default expiration period
    
    // Delete any existing default settings to ensure clean state
    await context.db('default_billing_settings')
      .where({ tenant: context.tenantId })
      .delete();
    
    // Create new default settings
    await context.db('default_billing_settings').insert({
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true,
      credit_expiration_days: defaultExpirationDays,
      credit_expiration_notification_days: [30, 14, 7],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // Create NY tax rate (10%)
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0,
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create a service with negative rate
    const negativeService = await context.createEntity('service_catalog', {
      service_name: 'Credit Service',
      service_type: 'Fixed',
      default_rate: -5000, // -$50.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Credit Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Assign service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: negativeService,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create a billing cycle
    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();

    const billingCycleId = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Check initial credit balance is zero
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(0);

    // Generate negative invoice
    const invoice = await generateInvoice(billingCycleId);

    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }

    // Verify the invoice has a negative total
    expect(invoice.total_amount).toBeLessThan(0);
    expect(invoice.subtotal).toBe(-5000); // -$50.00
    expect(invoice.tax).toBe(0);          // $0.00 (no tax on negative amounts)
    expect(invoice.total_amount).toBe(-5000); // -$50.00

    // Finalize the invoice - this should create a credit with expiration date
    await finalizeInvoice(invoice.invoice_id);

    // Verify the company credit balance has increased
    const updatedCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(updatedCredit).toBe(5000); // $50.00 credit

    // Verify credit issuance transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_issuance_from_negative_invoice'
      })
      .first();

    // Verify transaction details
    expect(creditTransaction).toBeTruthy();
    expect(parseInt(creditTransaction.amount.toString())).toBe(5000); // $50.00
    expect(creditTransaction.description).toContain('Credit issued from negative invoice');

    // Verify the transaction has an expiration date
    expect(creditTransaction.expiration_date).toBeTruthy();
    
    // Calculate expected expiration date (current date + defaultExpirationDays)
    const today = new Date();
    const expectedExpirationDate = new Date(today);
    expectedExpirationDate.setDate(today.getDate() + defaultExpirationDays);
    
    // Convert both dates to date-only strings for comparison (ignoring time)
    const actualExpirationDate = new Date(creditTransaction.expiration_date);
    const actualDateString = actualExpirationDate.toISOString().split('T')[0];
    const expectedDateString = expectedExpirationDate.toISOString().split('T')[0];
    
    // Verify the expiration date matches default settings
    expect(actualDateString).toBe(expectedDateString);
    
    // Get the credit tracking entry
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify credit tracking entry has the same expiration date
    expect(creditTracking).toBeTruthy();
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(expectedExpirationDate));
    expect(creditTracking.is_expired).toBe(false);
    expect(Number(creditTracking.remaining_amount)).toBe(5000);
  });

  it('should verify that expired credits are excluded from credit application', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Expired Credit Application Test Company',
      billing_cycle: 'monthly',
      company_id: uuidv4(),
      tax_region: 'US-NY',
      is_tax_exempt: false,
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      is_inactive: false
    }, 'company_id');

    // Create NY tax rate
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0, // 10% for easy calculation
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up company tax settings
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create a service
    const service = await context.createEntity('service_catalog', {
      service_name: 'Standard Service',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Standard Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Link service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: service,
      tenant: context.tenantId,
      quantity: 1
    });

    // Create a billing cycle
    const now = createTestDate();
    const startDate = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate = Temporal.PlainDate.from(now).toString();
    
    const billingCycleId = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      period_start_date: startDate,
      period_end_date: endDate,
      effective_date: startDate
    }, 'billing_cycle_id');

    // Link plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // Step 1: Create an expired credit
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10); // 10 days ago
    const expiredDate = pastDate.toISOString();
    
    const expiredCreditAmount = 5000; // $50.00 credit
    const expiredPrepaymentInvoice = await createPrepaymentInvoice(
      company_id,
      expiredCreditAmount,
      expiredDate
    );
    
    // Step 2: Create an active credit
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // 30 days in the future
    const activeDate = futureDate.toISOString();
    
    const activeCreditAmount = 7000; // $70.00 credit
    const activePrepaymentInvoice = await createPrepaymentInvoice(
      company_id,
      activeCreditAmount,
      activeDate
    );
    
    // Step 3: Finalize both prepayment invoices to create the credits
    await finalizeInvoice(expiredPrepaymentInvoice.invoice_id);
    await finalizeInvoice(activePrepaymentInvoice.invoice_id);
    
    // Step 4: Get the credit transactions
    const expiredCreditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: expiredPrepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const activeCreditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: activePrepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Step 5: Manually expire the expired credit
    await context.db('credit_tracking')
      .where({
        transaction_id: expiredCreditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .update({
        is_expired: true,
        remaining_amount: 0,
        updated_at: new Date().toISOString()
      });
    
    // Create an expiration transaction
    await context.db('transactions').insert({
      transaction_id: uuidv4(),
      company_id: company_id,
      amount: -expiredCreditAmount,
      type: 'credit_expiration',
      status: 'completed',
      description: 'Credit expired',
      created_at: new Date().toISOString(),
      tenant: context.tenantId,
      related_transaction_id: expiredCreditTransaction.transaction_id
    });
    
    // Update company credit balance to reflect the expired credit
    await context.db('companies')
      .where({ company_id: company_id, tenant: context.tenantId })
      .update({
        credit_balance: activeCreditAmount, // Only the active credit remains
        updated_at: new Date().toISOString()
      });
    
    // Step 6: Verify initial credit balance (should only include active credit)
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(activeCreditAmount);
    
    // Step 7: Generate an invoice
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Step 8: Finalize the invoice to apply credit
    await finalizeInvoice(invoice.invoice_id);
    
    // Step 9: Get the updated invoice to verify credit application
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();
    
    // Step 10: Verify credit application
    // Calculate expected values
    const subtotal = 10000; // $100.00
    const tax = 1000;      // $10.00 (10% of $100)
    const totalBeforeCredit = subtotal + tax; // $110.00
    const expectedAppliedCredit = activeCreditAmount; // Only the active credit should be applied
    const expectedRemainingTotal = totalBeforeCredit - expectedAppliedCredit; // $110 - $70 = $40
    
    // Verify invoice values
    expect(updatedInvoice.subtotal).toBe(subtotal);
    expect(updatedInvoice.tax).toBe(tax);
    expect(updatedInvoice.credit_applied).toBe(expectedAppliedCredit);
    expect(parseInt(updatedInvoice.total_amount)).toBe(expectedRemainingTotal);
    
    // Step 11: Verify credit application transaction
    const creditApplicationTx = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    expect(creditApplicationTx).toBeTruthy();
    expect(parseFloat(creditApplicationTx.amount)).toBe(-expectedAppliedCredit);
    
    // Step 12: Verify the metadata contains only the active credit
    const metadata = typeof creditApplicationTx.metadata === 'string'
      ? JSON.parse(creditApplicationTx.metadata)
      : creditApplicationTx.metadata;
    
    expect(metadata.applied_credits).toBeTruthy();
    expect(metadata.applied_credits.length).toBe(1); // Only one credit should be applied
    
    // Verify the applied credit is the active one
    expect(metadata.applied_credits[0].transactionId).toBe(activeCreditTransaction.transaction_id);
    expect(metadata.applied_credits[0].amount).toBe(activeCreditAmount);
    
    // Step 13: Verify the expired credit was not used
    const expiredCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: expiredCreditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expiredCreditTracking.is_expired).toBe(true);
    expect(Number(expiredCreditTracking.remaining_amount)).toBe(0);
    
    // Step 14: Verify the active credit was fully used
    const activeCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: activeCreditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(activeCreditTracking.is_expired).toBe(false);
    expect(Number(activeCreditTracking.remaining_amount)).toBe(0); // Fully used
    
    // Step 15: Verify final credit balance is zero
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(0);
  });
});
