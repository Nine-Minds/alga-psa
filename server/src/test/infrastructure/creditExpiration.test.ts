import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { createPrepaymentInvoice } from '@/lib/actions/creditActions';
import { finalizeInvoice } from '@/lib/actions/invoiceActions';
import { createDefaultTaxSettings } from '@/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { expiredCreditsHandler } from '@/lib/jobs/handlers/expiredCreditsHandler';
import { toPlainDate } from '@/lib/utils/dateTimeUtils';

describe('Credit Expiration Tests', () => {
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

  describe('Credit Expiration Scenarios', () => {
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

  describe('Credit Creation with Expiration Settings', () => {
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
  });

  describe('Custom Expiration Dates', () => {
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

  describe('Credit Expiration from Negative Invoices', () => {
    
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
  });
});