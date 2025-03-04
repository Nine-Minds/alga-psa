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
 * Core tests for credit expiration functionality.
 * 
 * These tests focus on the fundamental behavior of the credit expiration system:
 * - Detecting and marking expired credits
 * - Creating expiration transactions
 * - Handling expiration dates correctly
 * - Preventing duplicate expirations
 */

describe('Credit Expiration Core Tests', () => {
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

  it('should verify that expired credits are properly marked as expired', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Expired Credit Marking Test Company',
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
    pastDate.setDate(pastDate.getDate() - 10); // 10 days ago
    const expirationDate = pastDate.toISOString();
    
    const prepaymentAmount = 8000; // $80.00 credit
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
    
    // Get the initial credit tracking entry
    const initialCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify initial state - credit should not be expired yet
    expect(initialCreditTracking).toBeTruthy();
    expect(initialCreditTracking.is_expired).toBe(false);
    expect(Number(initialCreditTracking.remaining_amount)).toBe(prepaymentAmount);
    expect(toPlainDate(initialCreditTracking.expiration_date)).toEqual(toPlainDate(expirationDate));
    
    // Run the expired credits handler to process expired credits
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Get the updated credit tracking entry
    const updatedCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify the credit is now properly marked as expired
    expect(updatedCreditTracking).toBeTruthy();
    expect(updatedCreditTracking.is_expired).toBe(true);
    expect(Number(updatedCreditTracking.remaining_amount)).toBe(0);
    
    // Verify the expiration transaction was created
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
    
    // Verify the company credit balance was updated
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(0);
  });

  it('should mark expired credits as expired and create expiration transactions', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Expired Credit Test Company',
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

    // Set up company billing settings with expiration days and explicitly enable credit expiration
    await context.db('company_billing_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true, // Explicitly enable credit expiration
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    // Also ensure default settings have credit expiration enabled
    const defaultSettings = await context.db('default_billing_settings')
      .where({ tenant: context.tenantId })
      .first();
    
    if (defaultSettings) {
      await context.db('default_billing_settings')
        .where({ tenant: context.tenantId })
        .update({
          enable_credit_expiration: true
        });
    } else {
      await context.db('default_billing_settings').insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 365,
        credit_expiration_notification_days: [30, 7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    // Step 1: Create prepayment invoice with manual expiration date in the past
    const prepaymentAmount = 10000; // $100.00 credit
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const expirationDate = pastDate.toISOString();
    
    console.log('Test: Creating prepayment invoice with expiration date:', expirationDate);
    
    const prepaymentInvoice = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount,
      expirationDate
    );
    
    console.log('Test: Prepayment invoice created:', prepaymentInvoice.invoice_id);
    
    // Step 2: Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    console.log('Test: Prepayment invoice finalized');
    
    // Step 3: Verify initial credit balance and credit tracking entry
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(prepaymentAmount);
    console.log('Test: Initial credit balance verified:', initialCredit);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    console.log('Test: Credit transaction found:', creditTransaction?.transaction_id);
    console.log('Test: Credit transaction expiration_date:', creditTransaction?.expiration_date);
    console.log('Test: Expected expiration_date:', expirationDate);
    
    // Log all columns in the transaction
    console.log('Test: All transaction columns:', Object.keys(creditTransaction || {}));
    
    // Check if the transactions table has the expiration_date column
    const hasColumn = await context.db.schema.hasColumn('transactions', 'expiration_date');
    console.log('Test: transactions table has expiration_date column:', hasColumn);
    
    // Log the SQL query that would be executed
    const query = context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .toSQL();
    console.log('Test: SQL query:', query.sql, query.bindings);
    
    expect(creditTransaction).toBeTruthy();
    expect(toPlainDate(creditTransaction.expiration_date)).toEqual(toPlainDate(expirationDate)); 
    
    // Get the credit tracking entry
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(creditTracking).toBeTruthy();
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(expirationDate));
    expect(creditTracking.is_expired).toBe(false);
    expect(Number(creditTracking.remaining_amount)).toBe(prepaymentAmount);
    
    // Step 4: Run the expired credits handler
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Step 5: Verify credit is now marked as expired
    const updatedCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking).toBeTruthy();
    expect(updatedCreditTracking.is_expired).toBe(true);
    expect(Number(updatedCreditTracking.remaining_amount)).toBe(0);
    
    // Step 6: Verify expiration transaction was created
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
    expect(expirationTransaction.description).toContain('Credit expired');
    
    // Step 7: Verify company credit balance was updated
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(0);
  });

  it('should only expire credits that have passed their expiration date', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Mixed Expiration Test Company',
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

    // Set up company billing settings with expiration days and explicitly enable credit expiration
    await context.db('company_billing_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true, // Explicitly enable credit expiration
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // Step 1: Create first prepayment invoice with expiration date in the past
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const pastExpirationDate = pastDate.toISOString();
    
    const prepaymentInvoice1 = await createPrepaymentInvoice(
      company_id, 
      5000, // $50.00 credit
      pastExpirationDate
    );
    
    // Step 2: Create second prepayment invoice with expiration date in the future
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // 30 days in the future
    const futureExpirationDate = futureDate.toISOString();
    
    const prepaymentInvoice2 = await createPrepaymentInvoice(
      company_id, 
      7000, // $70.00 credit
      futureExpirationDate
    );
    
    // Step 3: Finalize both prepayment invoices
    await finalizeInvoice(prepaymentInvoice1.invoice_id);
    await finalizeInvoice(prepaymentInvoice2.invoice_id);
    
    // Step 4: Verify initial credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(12000); // $120.00 total credit
    
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
    
    // Step 5: Run the expired credits handler
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Step 6: Verify only the expired credit is marked as expired
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
    
    // First credit should be expired
    expect(updatedCreditTracking1.is_expired).toBe(true);
    expect(Number(updatedCreditTracking1.remaining_amount)).toBe(0);
    
    // Second credit should still be active
    expect(updatedCreditTracking2.is_expired).toBe(false);
    expect(Number(updatedCreditTracking2.remaining_amount)).toBe(7000);
    
    // Step 7: Verify expiration transaction was created only for the expired credit
    const expirationTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction).toBeTruthy();
    expect(Number(expirationTransaction.amount)).toBe(-5000);
    
    // No expiration transaction should exist for the non-expired credit
    const nonExpirationTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction2.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(nonExpirationTransaction).toBeUndefined();
    
    // Step 8: Verify company credit balance was updated correctly
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(7000); // Only the non-expired credit remains
  });

  it('should not re-expire already expired credits', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Already Expired Test Company',
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

    // Set up company billing settings with expiration days and explicitly enable credit expiration
    await context.db('company_billing_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true, // Explicitly enable credit expiration
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // Step 1: Create prepayment invoice with expiration date in the past
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const expirationDate = pastDate.toISOString();
    
    const prepaymentInvoice = await createPrepaymentInvoice(
      company_id, 
      10000, // $100.00 credit
      expirationDate
    );
    
    // Step 2: Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Step 3: Run the expired credits handler first time
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Step 4: Verify credit is marked as expired and transaction created
    const updatedCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking.is_expired).toBe(true);
    
    const expirationTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction).toBeTruthy();
    
    // Step 5: Run the expired credits handler again
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Step 6: Verify no additional expiration transactions were created
    const expirationTransactions = await context.db('transactions')
      .where({
        company_id: company_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .count('* as count');
    
    expect(parseInt(expirationTransactions[0].count.toString(), 10)).toBe(1); // Still only one expiration transaction
  });
});
