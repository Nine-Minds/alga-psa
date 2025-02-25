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
 * Tests for credit creation with expiration dates.
 * 
 * These tests focus on how expiration dates are assigned to credits:
 * - Using company-specific settings to determine expiration dates
 * - Falling back to default settings when company settings are not available
 * - Supporting custom expiration dates specified during credit creation
 */

describe('Credit Creation and Dates Tests', () => {
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

  it('should create credits with expiration dates based on company settings', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Company Settings Expiration Test',
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

    // Set up company billing settings with specific expiration days and explicitly enable credit expiration
    const expirationDays = 45; // 45-day expiration period
    await context.db('company_billing_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true, // Explicitly enable credit expiration
      credit_expiration_days: expirationDays,
      credit_expiration_notification_days: [14, 7, 1],
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

    // Create prepayment invoice WITHOUT specifying an expiration date
    // This should use the company settings to determine the expiration date
    const prepaymentAmount = 15000; // $150.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount
      // No expiration date provided - should use company settings
    );
    
    // Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Verify the transaction has an expiration date
    expect(creditTransaction).toBeTruthy();
    expect(creditTransaction.expiration_date).toBeTruthy();
    
    // Calculate expected expiration date (current date + expirationDays)
    const today = new Date();
    const expectedExpirationDate = new Date(today);
    expectedExpirationDate.setDate(today.getDate() + expirationDays);
    
    // Convert both dates to date-only strings for comparison (ignoring time)
    const actualExpirationDate = new Date(creditTransaction.expiration_date);
    const actualDateString = actualExpirationDate.toISOString().split('T')[0];
    const expectedDateString = expectedExpirationDate.toISOString().split('T')[0];
    
    // Verify the expiration date matches company settings
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
    expect(Number(creditTracking.remaining_amount)).toBe(prepaymentAmount);
  });

  it('should create credits with expiration dates based on default settings when company settings are not available', async () => {
    // Create test company without company-specific billing settings
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Default Settings Expiration Test',
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
    const defaultExpirationDays = 180; // 180-day default expiration period
    
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

    // Create prepayment invoice WITHOUT specifying an expiration date
    // This should use the default settings to determine the expiration date
    const prepaymentAmount = 20000; // $200.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount
      // No expiration date provided - should use default settings
    );
    
    // Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Verify the transaction has an expiration date
    expect(creditTransaction).toBeTruthy();
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
    expect(Number(creditTracking.remaining_amount)).toBe(prepaymentAmount);
  });

  it('should allow prepayment invoices to specify custom expiration dates', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Custom Expiration Date Test Company',
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
    const companyExpirationDays = 30; // 30-day company expiration period
    await context.db('company_billing_settings').insert({
      company_id: company_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true,
      credit_expiration_days: companyExpirationDays,
      credit_expiration_notification_days: [7, 1],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    // Set up default billing settings with different expiration days
    const defaultExpirationDays = 60; // 60-day default expiration period
    await context.db('default_billing_settings')
      .where({ tenant: context.tenantId })
      .delete();
    
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

    // Create a custom expiration date (120 days in the future)
    const customExpirationDays = 120;
    const today = new Date();
    const customExpirationDate = new Date(today);
    customExpirationDate.setDate(today.getDate() + customExpirationDays);
    const customExpirationDateString = customExpirationDate.toISOString();

    // Create prepayment invoice WITH a custom expiration date
    const prepaymentAmount = 12500; // $125.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount,
      customExpirationDateString // Specify custom expiration date
    );
    
    // Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Verify the transaction has an expiration date
    expect(creditTransaction).toBeTruthy();
    expect(creditTransaction.expiration_date).toBeTruthy();
    
    // Convert both dates to date-only strings for comparison (ignoring time)
    const actualExpirationDate = new Date(creditTransaction.expiration_date);
    const actualDateString = actualExpirationDate.toISOString().split('T')[0];
    const expectedDateString = customExpirationDate.toISOString().split('T')[0];
    
    // Verify the expiration date matches the custom date, not company or default settings
    expect(actualDateString).toBe(expectedDateString);
    
    // Calculate company settings expiration date for comparison
    const companyExpirationDate = new Date(today);
    companyExpirationDate.setDate(today.getDate() + companyExpirationDays);
    const companyExpirationDateString = companyExpirationDate.toISOString().split('T')[0];
    
    // Calculate default settings expiration date for comparison
    const defaultExpirationDate = new Date(today);
    defaultExpirationDate.setDate(today.getDate() + defaultExpirationDays);
    const defaultExpirationDateString = defaultExpirationDate.toISOString().split('T')[0];
    
    // Verify the expiration date does NOT match company or default settings
    expect(actualDateString).not.toBe(companyExpirationDateString);
    expect(actualDateString).not.toBe(defaultExpirationDateString);
    
    // Get the credit tracking entry
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify credit tracking entry has the same custom expiration date
    expect(creditTracking).toBeTruthy();
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(customExpirationDateString));
    expect(creditTracking.is_expired).toBe(false);
    expect(Number(creditTracking.remaining_amount)).toBe(prepaymentAmount);
  });
});
