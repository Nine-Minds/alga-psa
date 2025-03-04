import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { createPrepaymentInvoice, applyCreditToInvoice } from 'server/src/lib/actions/creditActions';
import { finalizeInvoice, generateInvoice } from 'server/src/lib/actions/invoiceActions';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import CompanyBillingPlan from 'server/src/lib/models/clientBilling';
import { createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { expiredCreditsHandler } from 'server/src/lib/jobs/handlers/expiredCreditsHandler';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';

/**
 * Tests for the effects of credit expiration on the system.
 * 
 * These tests focus on the side effects and system-wide impacts of credit expiration:
 * - Company-specific credit expiration processing
 * - Ensuring expired credits have their remaining amount set to zero
 * - Verifying expiration transactions are created correctly
 * - Confirming company credit balances are properly reduced
 */

describe('Credit Expiration Effects Tests', () => {
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

  it('should process expired credits for a specific company when company ID is provided', async () => {
    // Create two test companies
    const company1_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Company 1 Expiration Test',
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
    
    const company2_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Company 2 Expiration Test',
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

    // Set up company billing settings for both companies with credit expiration explicitly enabled
    await context.db('company_billing_settings').insert([
      {
        company_id: company1_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true, // Explicitly enable credit expiration
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        company_id: company2_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true, // Explicitly enable credit expiration
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ]);

    // Create expired credits for both companies
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const expirationDate = pastDate.toISOString();
    
    // Create and finalize prepayment invoices for both companies
    const prepaymentInvoice1 = await createPrepaymentInvoice(
      company1_id, 
      5000, // $50.00 credit
      expirationDate
    );
    
    const prepaymentInvoice2 = await createPrepaymentInvoice(
      company2_id, 
      7000, // $70.00 credit
      expirationDate
    );
    
    await finalizeInvoice(prepaymentInvoice1.invoice_id);
    await finalizeInvoice(prepaymentInvoice2.invoice_id);
    
    // Get the credit transactions
    const creditTransaction1 = await context.db('transactions')
      .where({
        company_id: company1_id,
        invoice_id: prepaymentInvoice1.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const creditTransaction2 = await context.db('transactions')
      .where({
        company_id: company2_id,
        invoice_id: prepaymentInvoice2.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Run the expired credits handler for company1 only
    await expiredCreditsHandler({ 
      tenantId: context.tenantId,
      companyId: company1_id
    });
    
    // Verify company1's credit is expired
    const updatedCreditTracking1 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking1.is_expired).toBe(true);
    expect(Number(updatedCreditTracking1.remaining_amount)).toBe(0);
    
    // Verify company2's credit is still active
    const updatedCreditTracking2 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction2.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking2.is_expired).toBe(false);
    expect(Number(updatedCreditTracking2.remaining_amount)).toBe(7000);
    
    // Verify expiration transaction was created only for company1
    const expirationTransaction1 = await context.db('transactions')
      .where({
        company_id: company1_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction1).toBeTruthy();
    
    const expirationTransaction2 = await context.db('transactions')
      .where({
        company_id: company2_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction2.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction2).toBeUndefined();
    
    // Verify company credit balances
    const company1Credit = await CompanyBillingPlan.getCompanyCredit(company1_id);
    const company2Credit = await CompanyBillingPlan.getCompanyCredit(company2_id);
    
    expect(company1Credit).toBe(0); // Credit expired
    expect(company2Credit).toBe(7000); // Credit still active
  });

  it('should test that expired credits have their remaining amount set to zero', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Zero Remaining Amount Test Company',
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

    // Set up company billing settings with expiration days
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

    // Create multiple credits with different amounts and expiration dates
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const expiredDate = pastDate.toISOString();
    
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // 30 days in future
    const activeDate = futureDate.toISOString();
    
    // Create and finalize first prepayment invoice (will expire)
    const prepaymentAmount1 = 12500; // $125.00
    const prepaymentInvoice1 = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount1,
      expiredDate
    );
    await finalizeInvoice(prepaymentInvoice1.invoice_id);
    
    // Create and finalize second prepayment invoice (will remain active)
    const prepaymentAmount2 = 7500; // $75.00
    const prepaymentInvoice2 = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount2,
      activeDate
    );
    await finalizeInvoice(prepaymentInvoice2.invoice_id);
    
    // Get the credit transactions
    const creditTransaction1 = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: prepaymentInvoice1.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const creditTransaction2 = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: prepaymentInvoice2.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Get the initial credit tracking entries
    const initialCreditTracking1 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    const initialCreditTracking2 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction2.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify initial state
    expect(initialCreditTracking1.is_expired).toBe(false);
    expect(Number(initialCreditTracking1.remaining_amount)).toBe(prepaymentAmount1);
    
    expect(initialCreditTracking2.is_expired).toBe(false);
    expect(Number(initialCreditTracking2.remaining_amount)).toBe(prepaymentAmount2);
    
    // Verify initial company credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(prepaymentAmount1 + prepaymentAmount2);
    
    // Run the expired credits handler
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Get the updated credit tracking entries
    const updatedCreditTracking1 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    const updatedCreditTracking2 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction2.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify the expired credit has its remaining amount set to zero
    expect(updatedCreditTracking1.is_expired).toBe(true);
    expect(Number(updatedCreditTracking1.remaining_amount)).toBe(0);
    
    // Verify the active credit is unchanged
    expect(updatedCreditTracking2.is_expired).toBe(false);
    expect(Number(updatedCreditTracking2.remaining_amount)).toBe(prepaymentAmount2);
    
    // Verify the company credit balance was reduced by the expired credit amount
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(prepaymentAmount2);
    
    // Verify the expiration transaction was created with the correct amount
    const expirationTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction).toBeTruthy();
    expect(Number(expirationTransaction.amount)).toBe(-prepaymentAmount1);
  });

  it('should test that expiration transactions are created when credits expire', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Expiration Transaction Test Company',
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

    // Set up company billing settings with expiration days
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

    // Create prepayment invoice with expiration date in the past
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 7); // 7 days ago
    const expirationDate = pastDate.toISOString();
    
    const prepaymentAmount = 12500; // $125.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount,
      expirationDate
    );
    
    // Finalize the prepayment invoice to create the credit
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Verify initial state
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(prepaymentAmount);
    
    // Run the expired credits handler to process expired credits
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Verify the expiration transaction was created
    const expirationTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify the expiration transaction exists
    expect(expirationTransaction).toBeTruthy();
    
    // Verify the transaction amount is negative and matches the credit amount
    expect(Number(expirationTransaction.amount)).toBe(-prepaymentAmount);
    
    // Verify the transaction is linked to the original credit transaction
    expect(expirationTransaction.related_transaction_id).toBe(creditTransaction.transaction_id);
    
    // Verify the transaction description indicates it's for credit expiration
    expect(expirationTransaction.description).toContain('Credit expired');
    
    // Verify the transaction has the correct company ID
    expect(expirationTransaction.company_id).toBe(company_id);
    
    // Verify the transaction has the correct type
    expect(expirationTransaction.type).toBe('credit_expiration');
    
    // Verify the transaction has a created_at timestamp
    expect(expirationTransaction.created_at).toBeTruthy();
    
    // Verify the company credit balance was updated
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(0);
    
    // Verify the credit tracking entry is marked as expired
    const updatedCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking.is_expired).toBe(true);
    expect(Number(updatedCreditTracking.remaining_amount)).toBe(0);
  });

  it('should validate that company credit balance is reduced when credits expire', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Credit Balance Reduction Test Company',
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

    // Set up company billing settings with expiration days
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

    // Create credits with different expiration dates
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10); // 10 days ago
    const expiredDate = pastDate.toISOString();
    
    // Create and finalize prepayment invoice with expired date
    const prepaymentAmount = 15000; // $150.00
    const prepaymentInvoice = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount,
      expiredDate
    );
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Verify initial credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(prepaymentAmount);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Run the expired credits handler
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Verify company credit balance is reduced to zero
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(0);
    
    // Verify the expiration transaction was created with the correct amount
    const expirationTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction).toBeTruthy();
    expect(Number(expirationTransaction.amount)).toBe(-prepaymentAmount);
    
    // Verify the credit tracking entry is marked as expired
    const updatedCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking.is_expired).toBe(true);
    expect(Number(updatedCreditTracking.remaining_amount)).toBe(0);
    
    // Verify the company record has been updated with the reduced credit balance
    const updatedCompany = await context.db('companies')
      .where({
        company_id: company_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(Number(updatedCompany.credit_balance)).toBe(0);
  });
});
