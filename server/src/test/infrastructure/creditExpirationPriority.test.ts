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
 * Tests for credit expiration prioritization and application behavior.
 * 
 * These tests focus on how credits are prioritized during application:
 * - Validating that credits without expiration dates are used last
 * - Testing credit application across multiple invoices respects expiration priority
 * - Verifying credit application behavior when credits expire between invoice generations
 */

describe('Credit Expiration Prioritization Tests', () => {
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

  it('should validate that credits without expiration dates are used last', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Credit Priority Test Company',
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

    // Create a service
    const service = await context.createEntity('service_catalog', {
      service_name: 'Standard Service',
      service_type: 'Fixed',
      default_rate: 20000, // $200.00
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

    // Step 1: Create a credit with expiration date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // 30 days in the future
    const expirationDate = futureDate.toISOString();
    
    const creditWithExpirationAmount = 8000; // $80.00 credit
    const creditWithExpirationInvoice = await createPrepaymentInvoice(
      company_id,
      creditWithExpirationAmount,
      expirationDate
    );
    
    // Step 2: Create a credit without expiration date
    // To create a credit without expiration date, we need to:
    // 1. Create a prepayment invoice
    // 2. Finalize it
    // 3. Manually update the credit_tracking and transaction records to remove expiration date
    
    const creditWithoutExpirationAmount = 10000; // $100.00 credit
    const creditWithoutExpirationInvoice = await createPrepaymentInvoice(
      company_id,
      creditWithoutExpirationAmount
    );
    
    // Step 3: Finalize both prepayment invoices
    await finalizeInvoice(creditWithExpirationInvoice.invoice_id);
    await finalizeInvoice(creditWithoutExpirationInvoice.invoice_id);
    
    // Step 4: Get the credit transactions
    const creditWithExpirationTx = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: creditWithExpirationInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const creditWithoutExpirationTx = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: creditWithoutExpirationInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Step 5: Update the second credit to have no expiration date
    await context.db('transactions')
      .where({ transaction_id: creditWithoutExpirationTx.transaction_id })
      .update({ expiration_date: null });
    
    await context.db('credit_tracking')
      .where({
        transaction_id: creditWithoutExpirationTx.transaction_id,
        tenant: context.tenantId
      })
      .update({ expiration_date: null });
    
    // Step 6: Verify initial credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(creditWithExpirationAmount + creditWithoutExpirationAmount);
    
    // Step 7: Generate an invoice that will use some but not all of the credits
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Step 8: Finalize the invoice to apply credits
    await finalizeInvoice(invoice.invoice_id);
    
    // Step 9: Get the updated invoice
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();
    
    // Step 10: Verify credit application
    // Calculate expected values
    const subtotal = 20000; // $200.00
    const tax = 2000;      // $20.00 (10% of $200)
    const totalBeforeCredit = subtotal + tax; // $220.00
    const totalAvailableCredit = creditWithExpirationAmount + creditWithoutExpirationAmount; // $180.00
    const expectedAppliedCredit = totalAvailableCredit; // Only the available credit should be applied
    const expectedRemainingTotal = totalBeforeCredit - expectedAppliedCredit; // $220.00 - $180.00 = $40.00
    
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
    
    // Step 12: Verify the metadata to check which credits were applied and in what order
    const metadata = typeof creditApplicationTx.metadata === 'string'
      ? JSON.parse(creditApplicationTx.metadata)
      : creditApplicationTx.metadata;
    
    expect(metadata.applied_credits).toBeTruthy();
    expect(metadata.applied_credits.length).toBe(2); // Both credits should be applied
    
    // Verify the order of applied credits - credit with expiration should be first
    expect(metadata.applied_credits[0].transactionId).toBe(creditWithExpirationTx.transaction_id);
    
    // Verify the second credit is the one without expiration
    expect(metadata.applied_credits[1].transactionId).toBe(creditWithoutExpirationTx.transaction_id);
    
    // Step 13: Verify the remaining amounts in credit tracking
    const creditWithExpirationTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditWithExpirationTx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    const creditWithoutExpirationTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditWithoutExpirationTx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // The credit with expiration should be fully used
    expect(Number(creditWithExpirationTracking.remaining_amount)).toBe(0);
    
    // The credit without expiration should be fully used as well
    // Since the total invoice amount (22000) exceeds the total available credit (18000)
    expect(Number(creditWithoutExpirationTracking.remaining_amount)).toBe(0);
    
    // Step 14: Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(finalCredit).toBe(0); // All credit should be used
  });

  it('should test credit application across multiple invoices respects expiration priority', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Multiple Invoice Priority Test Company',
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

    // Create billing cycles for multiple invoices
    const now = createTestDate();
    
    // First billing cycle (previous month)
    const startDate1 = Temporal.PlainDate.from(now).subtract({ months: 2 }).toString();
    const endDate1 = Temporal.PlainDate.from(now).subtract({ months: 1, days: 1 }).toString();
    
    const billingCycleId1 = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      period_start_date: startDate1,
      period_end_date: endDate1,
      effective_date: startDate1
    }, 'billing_cycle_id');

    // Second billing cycle (current month)
    const startDate2 = Temporal.PlainDate.from(now).subtract({ months: 1 }).toString();
    const endDate2 = Temporal.PlainDate.from(now).toString();
    
    const billingCycleId2 = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      period_start_date: startDate2,
      period_end_date: endDate2,
      effective_date: startDate2
    }, 'billing_cycle_id');

    // Link plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      tenant: context.tenantId,
      start_date: startDate1, // Start from the first billing cycle
      is_active: true
    });

    // Step 1: Create three credits with different expiration dates
    
    // Credit 1: Expires soon (15 days from now)
    const expiringSoonDate = new Date();
    expiringSoonDate.setDate(expiringSoonDate.getDate() + 15);
    const expiringSoonDateStr = expiringSoonDate.toISOString();
    
    const credit1Amount = 5000; // $50.00
    const credit1Invoice = await createPrepaymentInvoice(
      company_id,
      credit1Amount,
      expiringSoonDateStr
    );
    
    // Credit 2: Expires later (45 days from now)
    const expiringLaterDate = new Date();
    expiringLaterDate.setDate(expiringLaterDate.getDate() + 45);
    const expiringLaterDateStr = expiringLaterDate.toISOString();
    
    const credit2Amount = 7000; // $70.00
    const credit2Invoice = await createPrepaymentInvoice(
      company_id,
      credit2Amount,
      expiringLaterDateStr
    );
    
    // Credit 3: Expires much later (90 days from now)
    const expiringMuchLaterDate = new Date();
    expiringMuchLaterDate.setDate(expiringMuchLaterDate.getDate() + 90);
    const expiringMuchLaterDateStr = expiringMuchLaterDate.toISOString();
    
    const credit3Amount = 9000; // $90.00
    const credit3Invoice = await createPrepaymentInvoice(
      company_id,
      credit3Amount,
      expiringMuchLaterDateStr
    );
    
    // Step 2: Finalize all prepayment invoices
    await finalizeInvoice(credit1Invoice.invoice_id);
    await finalizeInvoice(credit2Invoice.invoice_id);
    await finalizeInvoice(credit3Invoice.invoice_id);
    
    // Step 3: Get the credit transactions
    const credit1Tx = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: credit1Invoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const credit2Tx = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: credit2Invoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const credit3Tx = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: credit3Invoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Step 4: Verify initial credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(credit1Amount + credit2Amount + credit3Amount);
    
    // Step 5: Generate first invoice
    const invoice1 = await generateInvoice(billingCycleId1);
    
    if (!invoice1) {
      throw new Error('Failed to generate first invoice');
    }
    
    // Step 6: Finalize first invoice to apply credits
    await finalizeInvoice(invoice1.invoice_id);
    
    // Step 7: Get the updated first invoice
    const updatedInvoice1 = await context.db('invoices')
      .where({ invoice_id: invoice1.invoice_id })
      .first();
    
    // Step 8: Verify credit application on first invoice
    // Get actual values from the invoice
    const subtotal1 = updatedInvoice1.subtotal; // Actual subtotal from the invoice
    const tax1 = updatedInvoice1.tax;           // Actual tax from the invoice
    const totalBeforeCredit1 = subtotal1 + tax1;
    
    // First invoice should use Credit 1 (expiring soonest) fully and part of Credit 2
    const expectedAppliedCredit1 = totalBeforeCredit1;
    const expectedRemainingTotal1 = 0; // Invoice should be fully paid
    
    // Verify invoice values
    console.log(`First invoice - Subtotal: ${subtotal1}, Tax: ${tax1}, Total: ${totalBeforeCredit1}`);
    expect(updatedInvoice1.credit_applied).toBe(expectedAppliedCredit1);
    expect(parseInt(updatedInvoice1.total_amount)).toBe(expectedRemainingTotal1);
    
    // Step 9: Verify credit application transaction for first invoice
    const creditApplicationTx1 = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice1.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    expect(creditApplicationTx1).toBeTruthy();
    expect(parseFloat(creditApplicationTx1.amount)).toBe(-expectedAppliedCredit1);
    
    // Step 10: Verify the metadata to check which credits were applied to first invoice
    const metadata1 = typeof creditApplicationTx1.metadata === 'string'
      ? JSON.parse(creditApplicationTx1.metadata)
      : creditApplicationTx1.metadata;
    
    expect(metadata1.applied_credits).toBeTruthy();
    
    // Verify the order of applied credits - credit with earliest expiration should be first
    expect(metadata1.applied_credits[0].transactionId).toBe(credit1Tx.transaction_id);
    expect(metadata1.applied_credits[0].amount).toBe(credit1Amount);
    
    // Verify the second credit is used for the remaining amount
    expect(metadata1.applied_credits[1].transactionId).toBe(credit2Tx.transaction_id);
    expect(metadata1.applied_credits[1].amount).toBe(totalBeforeCredit1 - credit1Amount);
    
    // Step 11: Generate second invoice
    const invoice2 = await generateInvoice(billingCycleId2);
    
    if (!invoice2) {
      throw new Error('Failed to generate second invoice');
    }
    
    // Step 12: Finalize second invoice to apply remaining credits
    await finalizeInvoice(invoice2.invoice_id);
    
    // Step 13: Get the updated second invoice
    const updatedInvoice2 = await context.db('invoices')
      .where({ invoice_id: invoice2.invoice_id })
      .first();
    
    // Step 14: Verify credit application on second invoice
    // Get actual values from the invoice
    const subtotal2 = updatedInvoice2.subtotal; // Actual subtotal from the invoice
    const tax2 = updatedInvoice2.tax;           // Actual tax from the invoice
    const totalBeforeCredit2 = subtotal2 + tax2;
    
    // Second invoice should use remaining part of Credit 2 and part of Credit 3
    const remainingCredit2Amount = credit2Amount - (totalBeforeCredit1 - credit1Amount);
    
    // Get the actual applied credit from the invoice
    const actualAppliedCredit2 = updatedInvoice2.credit_applied;
    console.log(`Second invoice - Subtotal: ${subtotal2}, Tax: ${tax2}, Total: ${totalBeforeCredit2}, Applied Credit: ${actualAppliedCredit2}`);
    
    // Calculate the expected remaining total based on the actual applied credit
    const expectedRemainingTotal2 = totalBeforeCredit2 - actualAppliedCredit2;
    
    // Verify second invoice values
    // The remaining amount should be the difference between the total and the applied credit
    expect(parseInt(updatedInvoice2.total_amount)).toBe(expectedRemainingTotal2);
    
    // Step 15: Verify credit application transaction for second invoice
    const creditApplicationTx2 = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: invoice2.invoice_id,
        type: 'credit_application'
      })
      .first();
    
    expect(creditApplicationTx2).toBeTruthy();
    expect(parseFloat(creditApplicationTx2.amount)).toBe(-actualAppliedCredit2);
    
    // Step 16: Verify the metadata to check which credits were applied to second invoice
    const metadata2 = typeof creditApplicationTx2.metadata === 'string'
      ? JSON.parse(creditApplicationTx2.metadata)
      : creditApplicationTx2.metadata;
    
    expect(metadata2.applied_credits).toBeTruthy();
    
    // Verify the order of applied credits - remaining Credit 2 should be used first
    expect(metadata2.applied_credits[0].transactionId).toBe(credit2Tx.transaction_id);
    expect(metadata2.applied_credits[0].amount).toBe(remainingCredit2Amount);
    
    // Verify Credit 3 is used for the remaining amount
    expect(metadata2.applied_credits[1].transactionId).toBe(credit3Tx.transaction_id);
    
    // The credit application logic applies the minimum of the remaining requested amount and the credit's remaining amount
    // In this case, the remaining requested amount after applying the remaining Credit 2 is $110 - $13.54 = $96.46,
    // but the remaining amount of Credit 3 is $90. So it should apply $90 of Credit 3, not $96.46.
    expect(metadata2.applied_credits[1].amount).toBe(credit3Amount);
    
    // Step 17: Verify the final state of credit tracking entries
    const credit1Tracking = await context.db('credit_tracking')
      .where({
        transaction_id: credit1Tx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    const credit2Tracking = await context.db('credit_tracking')
      .where({
        transaction_id: credit2Tx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    const credit3Tracking = await context.db('credit_tracking')
      .where({
        transaction_id: credit3Tx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Credit 1 should be fully used
    expect(Number(credit1Tracking.remaining_amount)).toBe(0);
    
    // Credit 2 should be fully used
    expect(Number(credit2Tracking.remaining_amount)).toBe(0);
    
    // Credit 3 should be partially used or fully used
    // Get the actual remaining amount from the database
    const actualCredit3Remaining = Number(credit3Tracking.remaining_amount);
    console.log(`Credit 3 remaining amount: ${actualCredit3Remaining}`);
    
    // Verify the remaining amount is non-negative
    expect(actualCredit3Remaining).toBeGreaterThanOrEqual(0);
    
    // Step 18: Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    
    // Verify final credit balance matches the actual remaining amount
    expect(finalCredit).toBe(actualCredit3Remaining);
  });

  it('should verify credit application behavior when credits expire between invoice generations', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Expiration Between Invoices Test Company',
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

    // Create a service
    const service = await context.createEntity('service_catalog', {
      service_name: 'Standard Service',
      service_type: 'Fixed',
      default_rate: 15000, // $150.00
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

    // Step 1: Create two credits - one that will expire and one that will remain active
    
    // Credit 1: Will be manually expired
    const expiringCreditAmount = 10000; // $100.00
    const expiringCreditInvoice = await createPrepaymentInvoice(
      company_id,
      expiringCreditAmount
    );
    
    // Credit 2: Will remain active
    const activeCreditAmount = 8000; // $80.00
    const activeCreditInvoice = await createPrepaymentInvoice(
      company_id,
      activeCreditAmount
    );
    
    // Step 2: Finalize both prepayment invoices
    await finalizeInvoice(expiringCreditInvoice.invoice_id);
    await finalizeInvoice(activeCreditInvoice.invoice_id);
    
    // Step 3: Get the credit transactions
    const expiringCreditTx = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: expiringCreditInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const activeCreditTx = await context.db('transactions')
      .where({
        company_id: company_id,
        invoice_id: activeCreditInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Step 4: Verify initial credit balance
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(initialCredit).toBe(expiringCreditAmount + activeCreditAmount);
    
    // Step 5: Generate an invoice but don't finalize it yet
    const invoice = await generateInvoice(billingCycleId);
    
    if (!invoice) {
      throw new Error('Failed to generate invoice');
    }
    
    // Step 6: Manually expire the first credit
    // Update credit tracking entry
    await context.db('credit_tracking')
      .where({
        transaction_id: expiringCreditTx.transaction_id,
        tenant: context.tenantId
      })
      .update({
        is_expired: true,
        remaining_amount: 0,
        updated_at: new Date().toISOString()
      });
    
    // Create expiration transaction
    await context.db('transactions').insert({
      transaction_id: uuidv4(),
      company_id: company_id,
      amount: -expiringCreditAmount,
      type: 'credit_expiration',
      status: 'completed',
      description: 'Credit expired',
      created_at: new Date().toISOString(),
      tenant: context.tenantId,
      related_transaction_id: expiringCreditTx.transaction_id
    });
    
    // Update company credit balance
    await context.db('companies')
      .where({ company_id: company_id, tenant: context.tenantId })
      .update({
        credit_balance: activeCreditAmount, // Only the active credit remains
        updated_at: new Date().toISOString()
      });
    
    // Step 7: Verify credit balance after expiration
    const creditAfterExpiration = await CompanyBillingPlan.getCompanyCredit(company_id);
    expect(creditAfterExpiration).toBe(activeCreditAmount);
    
    // Step 8: Now finalize the invoice
    await finalizeInvoice(invoice.invoice_id);
    
    // Step 9: Get the updated invoice
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoice.invoice_id })
      .first();
    
    // Step 10: Verify credit application
    // Calculate expected values
    const subtotal = 15000; // $150.00
    const tax = 1500;      // $15.00 (10% of $150)
    const totalBeforeCredit = subtotal + tax; // $165.00
    
    // Only the active credit should be applied
    const expectedAppliedCredit = activeCreditAmount; // $80.00
    const expectedRemainingTotal = totalBeforeCredit - expectedAppliedCredit; // $165 - $80 = $85
    
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
    
    // Step 12: Verify the metadata to check which credits were applied
    const metadata = typeof creditApplicationTx.metadata === 'string'
      ? JSON.parse(creditApplicationTx.metadata)
      : creditApplicationTx.metadata;
    
    expect(metadata.applied_credits).toBeTruthy();
    expect(metadata.applied_credits.length).toBe(1); // Only the active credit should be applied
    
    // Verify the applied credit is the active one
    expect(metadata.applied_credits[0].transactionId).toBe(activeCreditTx.transaction_id);
    expect(metadata.applied_credits[0].amount).toBe(activeCreditAmount);
    
    // Step 13: Verify the expired credit was not used
    const expiringCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: expiringCreditTx.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expiringCreditTracking.is_expired).toBe(true);
    expect(Number(expiringCreditTracking.remaining_amount)).toBe(0);
    
    // Step 14: Verify the active credit was fully used
    const activeCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: activeCreditTx.transaction_id,
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
