import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { TestContext } from '../../../test-utils/testContext';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { generateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';
import { createDefaultTaxSettings } from 'server/src/lib/actions/taxSettingsActions';
import { v4 as uuidv4 } from 'uuid';

describe('Billing Invoice Consistency Checks', () => {
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
        'client_billing_cycles',
        'client_billing_plans',
        'plan_services',
        'service_catalog',
        'billing_plans',
        'bucket_plans',
        'tax_rates',
        'client_tax_settings'
      ],
      clientName: 'Test Client',
      userType: 'internal'
    });

    // Create default tax settings and billing settings
    await createDefaultTaxSettings(context.client.client_id);
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  describe('Tax Calculation Consistency', () => {
    it('should calculate tax consistently between manual and automatic invoices', async () => {
      // Set up test data
      const serviceId = await context.createEntity('service_catalog', {
        service_name: 'Test Service',
        service_type: 'Fixed',
        default_rate: 1000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY'
      }, 'service_id');

      // Create tax rate
      const taxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 8.875,
        description: 'NY State + City Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // Create billing cycle for automatic invoice
      const billingCycle = await context.createEntity('client_billing_cycles', {
        client_id: context.clientId,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      // Create and assign billing plan
      const planId = await context.createEntity('billing_plans', {
        plan_name: 'Test Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        plan_type: 'Fixed'
      }, 'plan_id');

      await context.db('plan_services').insert({
        plan_id: planId,
        service_id: serviceId,
        quantity: 1,
        tenant: context.tenantId
      });

      await context.db('client_billing_plans').insert({
        client_billing_plan_id: uuidv4(),
        client_id: context.clientId,
        plan_id: planId,
        start_date: '2025-02-01',
        is_active: true,
        tenant: context.tenantId
      });

      // Generate automatic invoice
      const autoInvoice = await generateInvoice(billingCycle);

      // Generate manual invoice with same parameters
      const manualInvoice = await generateManualInvoice({
        clientId: context.clientId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Test Service',
          rate: 1000
        }]
      });

      // Verify tax calculations match
      expect(autoInvoice!.tax).toBe(manualInvoice.tax);
      expect(autoInvoice!.subtotal).toBe(manualInvoice.subtotal);
      expect(autoInvoice!.total_amount).toBe(manualInvoice.total_amount);
    });
  });
});