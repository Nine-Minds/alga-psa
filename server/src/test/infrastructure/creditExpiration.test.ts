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

      // Set up company billing settings with expiration days
      await context.db('company_billing_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // Step 1: Create prepayment invoice with manual expiration date in the past
      const prepaymentAmount = 10000; // $100.00 credit
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
      const expirationDate = pastDate.toISOString();
      
      const prepaymentInvoice = await createPrepaymentInvoice(
        company_id, 
        prepaymentAmount,
        expirationDate
      );
      
      // Step 2: Finalize the prepayment invoice
      await finalizeInvoice(prepaymentInvoice.invoice_id);
      
      // Step 3: Verify initial credit balance and credit tracking entry
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
      
      expect(creditTransaction).toBeTruthy();
      expect(creditTransaction.expiration_date).toBe(expirationDate);
      
      // Get the credit tracking entry
      const creditTracking = await context.db('credit_tracking')
        .where({
          transaction_id: creditTransaction.transaction_id,
          tenant: context.tenantId
        })
        .first();
      
      expect(creditTracking).toBeTruthy();
      expect(creditTracking.expiration_date).toBe(expirationDate);
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

      // Set up company billing settings with expiration days
      await context.db('company_billing_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
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

      // Set up company billing settings with expiration days
      await context.db('company_billing_settings').insert({
        company_id: company_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
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
      
      expect(expirationTransactions[0].count).toBe(1); // Still only one expiration transaction
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

      // Set up company billing settings for both companies
      await context.db('company_billing_settings').insert([
        {
          company_id: company1_id,
          tenant: context.tenantId,
          zero_dollar_invoice_handling: 'normal',
          suppress_zero_dollar_invoices: false,
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
  });
});