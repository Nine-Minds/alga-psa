import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { generateInvoice } from '@/lib/actions/invoiceActions';
import { createDefaultTaxSettings } from '@/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';

describe('Billing Invoice Edge Cases', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'tickets',
        'company_billing_cycles',
        'company_billing_plans',
        'plan_services',
        'service_catalog',
        'billing_plans',
        'bucket_plans',
        'tax_rates',
        'company_tax_settings',
        'transactions'
      ],
      companyName: 'Test Company',
      userType: 'internal'
    });

    // Create default tax settings and billing settings
    await createDefaultTaxSettings(context.company.company_id);
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  it('should validate total calculation for negative subtotal (credit note)', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Credit Note Company',
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

    // Create NY tax rate (10% but won't apply to negative amounts)
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

    // Create services with negative rates (credits)
    const serviceA = await context.createEntity('service_catalog', {
      service_name: 'Credit Service A',
      service_type: 'Fixed',
      default_rate: -5000, // -$50.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    const serviceB = await context.createEntity('service_catalog', {
      service_name: 'Credit Service B',
      service_type: 'Fixed',
      default_rate: -7500, // -$75.00
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

    // Assign services to plan
    await context.db('plan_services').insert([
      {
        plan_id: planId,
        service_id: serviceA,
        quantity: 1,
        tenant: context.tenantId
      },
      {
        plan_id: planId,
        service_id: serviceB,
        quantity: 1,
        tenant: context.tenantId
      }
    ]);

    // Create billing cycle
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      start_date: '2025-02-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);

    // Verify calculations:
    // Service A: -$50.00 (-5000 cents)
    // Service B: -$75.00 (-7500 cents)
    // Subtotal: -$125.00 (-12500 cents)
    // Tax: $0.00 (no tax on credits)
    // Total: -$125.00 (-12500 cents)
    expect(invoice!.subtotal).toBe(-12500); // -$125.00
    expect(invoice!.tax).toBe(0);           // $0.00 (no tax on negative amounts)
    expect(invoice!.total_amount).toBe(-12500); // -$125.00

    // Additional verification
    expect(invoice!.subtotal).toBeLessThan(0);  // Verify subtotal is negative
    expect(invoice!.tax).toBe(0);              // Verify no tax is charged on credits
    expect(invoice!.total_amount).toBe(invoice!.subtotal); // Verify total equals negative subtotal

    // Get invoice items to verify individual calculations
    const invoiceItems = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id })
      .orderBy('net_amount', 'desc');

    // Verify each service's tax calculation
    for (const item of invoiceItems) {
      expect(parseInt(item.tax_amount)).toBe(0); // Each item should have zero tax
      expect(parseInt(item.total_price)).toBe(parseInt(item.net_amount)); // Total should equal net amount
    }
  });

  it('should properly handle true zero-value invoices through the entire workflow', async () => {
    // Create test company
    const company_id = await context.createEntity<ICompany>('companies', {
      company_name: 'Zero Value Invoice Company',
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

    // Create tax rate settings
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

    // Create a free service with zero price
    const freeService = await context.createEntity('service_catalog', {
      service_name: 'Free Service',
      service_type: 'Fixed',
      default_rate: 0, // $0.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true // Even though it's taxable, tax on $0 is $0
    }, 'service_id');

    // Create a billing plan with the free service
    const planId = await context.createEntity('billing_plans', {
      plan_name: 'Free Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    }, 'plan_id');

    // Assign free service to plan
    await context.db('plan_services').insert({
      plan_id: planId,
      service_id: freeService,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle
    const billingCycle = await context.createEntity('company_billing_cycles', {
      company_id: company_id,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    // Assign plan to company
    await context.db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: company_id,
      plan_id: planId,
      start_date: '2025-02-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Step 1: Generate invoice
    const draftInvoice = await generateInvoice(billingCycle);

    // Verify invoice properties
    expect(draftInvoice).toBeTruthy();
    expect(draftInvoice!.subtotal).toBe(0);           // $0.00 subtotal
    expect(draftInvoice!.tax).toBe(0);                // $0.00 tax (10% of $0 is $0)
    expect(draftInvoice!.total_amount).toBe(0);       // $0.00 total
    expect(draftInvoice!.status).toBe('draft');       // Should be in draft status
    expect(draftInvoice!.invoice_number).toMatch(/^TIC\d{6}$/); // Should have a valid invoice number
    
    // Get invoice items to verify
    const invoiceItems = await context.db('invoice_items')
      .where({ invoice_id: draftInvoice!.invoice_id })
      .orderBy('created_at', 'asc');

    // Verify invoice items
    expect(invoiceItems).toHaveLength(1);  // Should have the one free service
    expect(parseInt(invoiceItems[0].net_amount)).toBe(0);
    expect(parseInt(invoiceItems[0].tax_amount)).toBe(0);
    expect(parseInt(invoiceItems[0].total_price)).toBe(0);
    expect(invoiceItems[0].service_id).toBe(freeService);

    // Step 2: Finalize the invoice
    await context.db('invoices')
      .where({ invoice_id: draftInvoice!.invoice_id })
      .update({ status: 'sent' });

    // Get the finalized invoice
    const finalizedInvoice = await context.db('invoices')
      .where({ invoice_id: draftInvoice!.invoice_id })
      .first();

    // Verify finalized invoice properties
    expect(finalizedInvoice.status).toBe('sent');
    expect(finalizedInvoice.subtotal).toBe(0);
    expect(finalizedInvoice.tax).toBe(0);
    expect(parseInt(finalizedInvoice.total_amount.toString())).toBe(0);

    // Step 3: Verify transaction handling for zero-value invoice
    const transactions = await context.db('transactions')
      .where({ invoice_id: draftInvoice!.invoice_id })
      .select();

    // Based on logs, a transaction record is created even for zero-value invoices
    expect(transactions).toHaveLength(1);
    
    if (transactions.length > 0) {
      // The transaction should have appropriate values
      const transaction = transactions[0];
      // We expect the transaction amount to be zero
      expect(parseInt(transaction.amount)).toBe(0);
      // Verify the transaction is properly linked to the company and invoice
      expect(transaction.company_id).toBe(company_id);
      expect(transaction.invoice_id).toBe(draftInvoice!.invoice_id);
    }

    // Step 4: Verify the company credit balance remains unchanged
    const companyAfter = await context.db('companies')
      .where({ company_id: company_id })
      .first();

    expect(companyAfter.credit_balance).toBe(0); // Should still be 0
  });
});