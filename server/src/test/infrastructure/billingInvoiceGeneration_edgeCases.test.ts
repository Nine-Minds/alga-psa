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
        'company_tax_settings'
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
});