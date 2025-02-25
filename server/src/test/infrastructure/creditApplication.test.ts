import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { createPrepaymentInvoice } from '@/lib/actions/creditActions';
import { finalizeInvoice, generateInvoice } from '@/lib/actions/invoiceActions';
import { createDefaultTaxSettings } from '@/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import CompanyBillingPlan from '@/lib/models/clientBilling';
import { createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';

describe('Credit Application Tests', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'transactions',
        'company_billing_cycles',
        'company_billing_plans',
        'plan_services',
        'service_catalog',
        'billing_plans',
        'bucket_plans',
        'bucket_usage',
        'tax_rates',
        'company_tax_settings'
      ],
      companyName: 'Credit Test Company',
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

  describe('Credit Application Scenarios', () => {
    it('should correctly apply credit when available credit is less than the invoice total', async () => {
      // Create test company
      const company_id = await context.createEntity<ICompany>('companies', {
        company_name: 'Partial Credit Test Company',
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
        service_name: 'Premium Service',
        service_type: 'Fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // Create a billing plan
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Test Plan',
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

      // Step 1: Create prepayment invoice with credit amount less than what will be needed
      const prepaymentAmount = 5000; // $50.00 credit
      const prepaymentInvoice = await createPrepaymentInvoice(company_id, prepaymentAmount);
      
      // Step 2: Finalize the prepayment invoice - prepayment invoices don't need a billing cycle
      await finalizeInvoice(prepaymentInvoice.invoice_id);
      
      // Step 3: Verify initial credit balance
      const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(initialCredit).toBe(prepaymentAmount);

      // Log credit balance before generating invoice
      console.log('Credit balance before generating invoice:', initialCredit);
      
      // Step 5: Generate an automatic invoice using the billing cycle
      const invoice = await generateInvoice(billingCycleId);
      
      if (!invoice) {
        throw new Error('Failed to generate invoice');
      }
      
      // Log invoice details
      console.log('Generated invoice:', {
        invoice_id: invoice.invoice_id,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total_amount: invoice.total_amount,
        credit_applied: invoice.credit_applied
      });
      
      // Log credit balance after generating invoice
      const creditAfterGeneration = await CompanyBillingPlan.getCompanyCredit(company_id);
      console.log('Credit balance after generating invoice:', creditAfterGeneration);

      // Step 6: Finalize the manual invoice to apply credit
      await finalizeInvoice(invoice.invoice_id);

      // Step 7: Get the updated invoice to verify credit application
      const updatedInvoice = await context.db('invoices')
        .where({ invoice_id: invoice.invoice_id })
        .first();

      // Step 8: Verify credit application
      expect(updatedInvoice.credit_applied).toBe(prepaymentAmount); // All $50 credit was applied
      
      // Calculate expected values
      const subtotal = 10000; // $100.00
      const tax = 1000;      // $10.00 (10% of $100)
      const totalBeforeCredit = subtotal + tax; // $110.00
      const expectedRemainingTotal = totalBeforeCredit - prepaymentAmount; // $110 - $50 = $60

      // Verify invoice totals
      expect(updatedInvoice.subtotal).toBe(subtotal);
      expect(updatedInvoice.tax).toBe(tax);
      expect(parseInt(updatedInvoice.total_amount)).toBe(expectedRemainingTotal);

      // Verify credit balance is now zero
      const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
      expect(finalCredit).toBe(0);

      // Verify credit application transaction
      const creditTransaction = await context.db('transactions')
        .where({
          company_id: company_id,
          invoice_id: invoice.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditTransaction).toBeTruthy();
      expect(parseFloat(creditTransaction.amount)).toBe(-prepaymentAmount);
      expect(creditTransaction.description).toContain('Applied credit to invoice');
    });
  });
});
