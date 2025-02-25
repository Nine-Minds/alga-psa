import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { createPrepaymentInvoice, applyCreditToInvoice, validateCreditBalance } from '@/lib/actions/creditActions';
import { finalizeInvoice, generateInvoice } from '@/lib/actions/invoiceActions';
import { createDefaultTaxSettings } from '@/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { createTestDate } from '../../../test-utils/dateUtils';

/**
 * Credit Reconciliation Tests
 * 
 * These tests focus on verifying that the credit tracking table correctly
 * reconciles with the transaction log, ensuring data integrity between
 * the two sources of truth for credit management.
 */

describe('Credit Reconciliation Tests', () => {
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
        'credit_allocations',
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
      companyName: 'Credit Reconciliation Test Company',
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

  it('should verify credit tracking table reconciliation with transaction log', async () => {
    // 1. Create test company with a unique name
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: `Credit Reconciliation Test Company ${Date.now()}`,
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

    // 2. Set up company billing settings with expiration days
    await context.db('company_billing_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true,
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    // Create tax settings for the company
    // First create a tax rate
    const nyTaxRateId = uuidv4();
    await context.db('tax_rates').insert({
      tax_rate_id: nyTaxRateId,
      region: 'US-NY',
      tax_percentage: 8.875,
      description: 'New York Sales Tax',
      start_date: '2025-01-01',
      tenant: context.tenantId
    });
    
    await context.db('company_tax_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // 3. Create first prepayment invoice
    const prepaymentAmount1 = 10000; // $100.00 credit
    const prepaymentInvoice1 = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount1
    );
    
    // 4. Finalize the first prepayment invoice to create the credit
    await finalizeInvoice(prepaymentInvoice1.invoice_id);
    
    // 5. Create second prepayment invoice
    const prepaymentAmount2 = 5000; // $50.00 credit
    const prepaymentInvoice2 = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount2
    );
    
    // 6. Finalize the second prepayment invoice to create the credit
    await finalizeInvoice(prepaymentInvoice2.invoice_id);
    
    // 7. Create a service for a positive invoice
    const serviceId = await context.createEntity('service_catalog', {
      service_name: 'Regular Service',
      service_type: 'Fixed',
      default_rate: 8000, // $80.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // 8. Create a billing plan
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Regular Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // 9. Assign service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      quantity: 1,
      tenant: context.tenantId
    });

    // 10. Create a billing cycle
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

    // 11. Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate,
      is_active: true
    });

    // 12. Generate positive invoice
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }

    // 13. Finalize the invoice to apply credit
    await finalizeInvoice(invoice.invoice_id);

    // 14. Manually apply some credit to create a partial application
    const remainingCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    const partialCreditAmount = 3000; // $30.00
    await applyCreditToInvoice(company_id, invoice.invoice_id, partialCreditAmount);

    // 15. Get the current credit balance before validation
    const beforeValidationCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    
    // 16. Get all credit tracking entries before validation
    const preValidationCreditEntries = await context.db('credit_tracking')
      .where({
        company_id: company_id,
        tenant: context.tenantId
      })
      .orderBy('created_at', 'asc');
    
    // 17. Calculate the expected credit balance based on credit tracking entries
    const expectedCreditBalance = preValidationCreditEntries.reduce(
      (sum, entry) => sum + Number(entry.remaining_amount),
      0
    );
    
    console.log(`Current credit balance: ${beforeValidationCredit}, Expected from tracking: ${expectedCreditBalance}`);
    
    // 18. Create an artificial discrepancy by directly modifying the company's credit_balance
    // This simulates a data corruption scenario that would require reconciliation
    const artificialBalance = expectedCreditBalance - 1000; // Reduce by $10.00
    await context.db('companies')
      .where({
        company_id: company_id,
        tenant: context.tenantId
      })
      .update({
        credit_balance: artificialBalance,
        updated_at: new Date().toISOString()
      });
    
    // Get the modified balance
    const modifiedBalance = await CompanyBillingPlan.getCompanyCredit(company_id);
    console.log(`Artificially modified balance: ${modifiedBalance}, Expected from tracking: ${expectedCreditBalance}`);
    
    // 19. Verify that there's a discrepancy between the actual and expected balance
    expect(modifiedBalance).not.toEqual(expectedCreditBalance);
    
    // 20. Now run the credit balance validation to check reconciliation
    // This will automatically correct any discrepancies
    const validationResult = await validateCreditBalance(company_id);
    
    // 21. Verify that the validation detected an issue
    expect(validationResult.isValid).toBe(false);
    
    // 22. After validation, the balance should be corrected, so run it again to verify
    const secondValidationResult = await validateCreditBalance(company_id);
    
    // 23. Verify that the second validation shows the balance is now correct
    expect(secondValidationResult.isValid).toBe(true);
    
    // 24. Get all credit-related transactions
    const transactions = await context.db('transactions')
      .where({
        company_id: company_id,
        tenant: context.tenantId
      })
      .whereIn('type', [
        'credit_issuance',
        'credit_application',
        'credit_adjustment',
        'credit_expiration',
        'credit_transfer'
      ])
      .orderBy('created_at', 'asc');
    
    // 25. Get all credit tracking entries
    const creditTrackingEntries = await context.db('credit_tracking')
      .where({
        company_id: company_id,
        tenant: context.tenantId
      })
      .orderBy('created_at', 'asc');
    
    // 26. Verify that each credit issuance transaction has a corresponding credit tracking entry
    const issuanceTransactions = transactions.filter(tx =>
      tx.type === 'credit_issuance' || tx.type === 'credit_issuance_from_negative_invoice'
    );
    
    for (const tx of issuanceTransactions) {
      const matchingEntry = creditTrackingEntries.find(entry => entry.transaction_id === tx.transaction_id);
      expect(matchingEntry).toBeTruthy();
      expect(Number(matchingEntry!.amount)).toBe(Number(tx.amount));
    }
    
    // 27. Verify that credit application transactions have updated the remaining amounts correctly
    const applicationTransactions = transactions.filter(tx => tx.type === 'credit_application');
    
    for (const tx of applicationTransactions) {
      // Find the related credit tracking entries that were affected by this application
      const relatedEntries = creditTrackingEntries.filter(entry => {
        // Check if this entry's transaction_id is referenced in the application's metadata
        if (tx.metadata && typeof tx.metadata === 'string') {
          const metadata = JSON.parse(tx.metadata);
          return metadata.applied_credits && metadata.applied_credits.some(
            (credit: { transactionId: string }) => credit.transactionId === entry.transaction_id
          );
        }
        return false;
      });
      
      // Verify that the sum of remaining amounts plus applied amounts equals the original amounts
      for (const entry of relatedEntries) {
        const originalAmount = Number(entry.amount);
        const remainingAmount = Number(entry.remaining_amount);
        
        // The remaining amount should be less than or equal to the original amount
        expect(remainingAmount).toBeLessThanOrEqual(originalAmount);
        
        // Find all application transactions that reference this credit
        const applicationsForThisCredit = applicationTransactions.filter(appTx => {
          if (appTx.metadata && typeof appTx.metadata === 'string') {
            const metadata = JSON.parse(appTx.metadata);
            return metadata.applied_credits && metadata.applied_credits.some(
              (credit: { transactionId: string }) => credit.transactionId === entry.transaction_id
            );
          }
          return false;
        });
        
        // Calculate total applied amount for this credit
        let totalApplied = 0;
        for (const appTx of applicationsForThisCredit) {
          if (appTx.metadata && typeof appTx.metadata === 'string') {
            const metadata = JSON.parse(appTx.metadata);
            const creditInfo = metadata.applied_credits.find(
              (credit: { transactionId: string }) => credit.transactionId === entry.transaction_id
            );
            if (creditInfo) {
              totalApplied += Number(creditInfo.amount);
            }
          }
        }
        
        // Verify that original amount = remaining amount + total applied
        expect(originalAmount).toBeCloseTo(remainingAmount + totalApplied, 2);
      }
    }
    
    // 28. Verify the company's credit balance matches the sum of remaining amounts in credit tracking
    const companyCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    const sumOfRemainingAmounts = creditTrackingEntries.reduce(
      (sum, entry) => sum + Number(entry.remaining_amount),
      0
    );
    
    expect(companyCredit).toBeCloseTo(sumOfRemainingAmounts, 2);
    
    // 29. Verify that the credit balance in the company record matches the calculated balance from transactions
    const calculatedBalance = transactions.reduce(
      (balance, tx) => balance + Number(tx.amount),
      0
    );
    
    expect(companyCredit).toBeCloseTo(calculatedBalance, 2);
  });
});