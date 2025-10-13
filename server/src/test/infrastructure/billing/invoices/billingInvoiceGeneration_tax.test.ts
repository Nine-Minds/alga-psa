import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import {
  createTestService,
  createFixedPlanAssignment,
  addServiceToFixedPlan,
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { generateInvoice } from 'server/src/lib/actions/invoiceGeneration';
import { generateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';
import { TextEncoder as NodeTextEncoder } from 'util';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/shared/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
  };
});

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(async () => ({
    user_id: mockedUserId,
    tenant: mockedTenantId,
    user_type: 'internal',
    roles: []
  }))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Billing Invoice Tax Calculations', () => {
  let context: TestContext;

  async function ensureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State + City Tax',
      startDate: '2025-01-01T00:00:00.000Z',
      taxPercentage: 10 // easier math for tests
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'usage_tracking',
        'bucket_usage',
        'time_entries',
        'tickets',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'bucket_plans',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates'
      ],
      clientName: 'Tax Test Client',
      userType: 'internal'
    });

    mockedTenantId = context.tenantId;
    mockedUserId = context.userId;
    await ensureDefaultTax();
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantId = context.tenantId;
    mockedUserId = context.userId;
    await ensureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  describe('Tax Calculation', () => {
    it('should verify total calculation when subtotal is zero but tax is positive', async () => {
      // Create test client
      const client_id = await context.createEntity<IClient>('clients', {
        client_name: 'Discount Tax Test Client',
        billing_cycle: 'monthly',
        client_id: uuidv4(),
        region_code: 'US-NY',
        is_tax_exempt: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString(),
        phone_no: '',
        credit_balance: 0,
        email: '',
        url: '',
        address: '',
        is_inactive: false
      }, 'client_id');

      // Create NY tax rate (10% for easy calculation)
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 10.0,
        description: 'NY Test Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // Set up client tax settings
      await context.db('client_tax_settings').insert({
        client_id: client_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // Create a service with a simple price
      const service = await context.createEntity('service_catalog', {
        service_name: 'Discounted Service',
        service_type: 'Fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      // Create a contract line
      const planId = await context.createEntity('contract_lines', {
        contract_line_name: 'Discount Test Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      // Assign service to plan
      await context.db('contract_line_services').insert({
        contract_line_id: planId,
        service_id: service,
        quantity: 1,
        tenant: context.tenantId
      });

      // Create billing cycle
      const billingCycle = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      // Assign plan to client
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: client_id,
        contract_line_id: planId,
        start_date: '2025-02-01',
        is_active: true,
        tenant: context.tenantId
      });

      // Create a 100% discount service
      const discountService = await context.createEntity('service_catalog', {
        service_name: 'Full Discount',
        service_type: 'Fixed',
        default_rate: -10000, // -$100.00 to fully offset the original service
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: false // Discounts are not taxable
      }, 'service_id');

      // Add discount service to plan
      await context.db('contract_line_services').insert({
        contract_line_id: planId,
        service_id: discountService,
        quantity: 1,
        tenant: context.tenantId
      });

      // Generate invoice with both the original service and the discount
      const invoice = await generateInvoice(billingCycle);

      // Verify calculations:
      // - Original service: $100.00
      // - Discount: -$100.00
      // - Subtotal: $0.00
      // - Tax: $10.00 (calculated on pre-discount amount)
      // - Total: $10.00 (just the tax)
      expect(invoice!.subtotal).toBe(0);       // $0.00 after discount
      expect(invoice!.tax).toBe(1000);         // $10.00 (10% of original $100)
      expect(invoice!.total_amount).toBe(1000); // $10.00 (tax only)

      // Get invoice items to verify individual calculations
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice!.invoice_id })
        .orderBy('net_amount', 'desc');

      // Verify we have both the original item and discount
      expect(invoiceItems).toHaveLength(2);

      // Original service should have tax
      const originalItem = invoiceItems.find(item => item.service_id === service);
      expect(parseInt(originalItem!.net_amount)).toBe(10000);
      expect(parseInt(originalItem!.tax_amount)).toBe(1000);

      // Discount item should have no tax
      const discountItem = invoiceItems.find(item => item.service_id === discountService);
      expect(parseInt(discountItem!.net_amount)).toBe(-10000);
      expect(parseInt(discountItem!.tax_amount)).toBe(0);
    });

    it('should calculate tax correctly for services with different tax regions', async () => {
      // Create test client
      const client_id = await context.createEntity<IClient>('clients', {
        client_name: 'Tax Test Client',
        billing_cycle: 'monthly',
        client_id: uuidv4(),
        region_code: 'US-NY', // Default tax region
        is_tax_exempt: false,
        phone_no: '',
        credit_balance: 0,
        email: '',
        url: '',
        address: '',
        is_inactive: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString()
      }, 'client_id');

      // Create tax rates for different regions
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 8.875,
        description: 'NY State + City Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      const caTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-CA',
        tax_percentage: 8.0,
        description: 'CA State Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // Set up client tax settings
      await context.db('client_tax_settings').insert({
        client_id: client_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // Create services with different tax regions
      const serviceNY = await context.createEntity('service_catalog', {
        service_name: 'NY Service',
        service_type: 'Fixed',
        default_rate: 1000,
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      const serviceCA = await context.createEntity('service_catalog', {
        service_name: 'CA Service',
        service_type: 'Fixed',
        default_rate: 500,
        unit_of_measure: 'unit',
        tax_region: 'US-CA',
        is_taxable: true
      }, 'service_id');

      // Create a contract line
      const planId = await context.createEntity('contract_lines', {
        contract_line_name: 'Multi-Region Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      // Assign services to plan
      await context.db('contract_line_services').insert([
        {
          contract_line_id: planId,
          service_id: serviceNY,
          quantity: 1,
          tenant: context.tenantId
        },
        {
          contract_line_id: planId,
          service_id: serviceCA,
          quantity: 1,
          tenant: context.tenantId
        }
      ]);

      // Create billing cycle
      const billingCycle = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      // Assign plan to client
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: client_id,
        contract_line_id: planId,
        start_date: '2025-02-01',
        is_active: true,
        tenant: context.tenantId
      });

      // Generate invoice
      const invoice = await generateInvoice(billingCycle);

      // Verify tax calculations:
      // NY Service: $10.00 * 8.875% = $0.89 (rounded up)
      // CA Service: $5.00 * 8.0% = $0.40
      // Total tax should be $1.29
      expect(invoice!.subtotal).toBe(1500); // $15.00
      expect(invoice!.tax).toBe(129); // $1.29
      expect(invoice!.total_amount).toBe(1629); // $16.29
    });

    it('should handle tax calculation correctly with mixed positive and negative amounts', async () => {
      // Create test client
      const client_id = await context.createEntity<IClient>('clients', {
        client_name: 'Mixed Tax Test Client',
        billing_cycle: 'monthly',
        client_id: uuidv4(),
        region_code: 'US-NY',
        is_tax_exempt: false,
        created_at: Temporal.Now.plainDateISO().toString(),
        updated_at: Temporal.Now.plainDateISO().toString(),
        phone_no: '',
        credit_balance: 0,
        email: '',
        url: '',
        address: '',
        is_inactive: false
      }, 'client_id');

      // Create NY tax rate
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 8.875,
        description: 'NY State + City Tax',
        start_date: '2025-01-01'
      }, 'tax_rate_id');

      // Set up client tax settings
      await context.db('client_tax_settings').insert({
        client_id: client_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // Create two services: regular and credit
      const regularService = await context.createEntity('service_catalog', {
        service_name: 'Regular Service',
        service_type: 'Fixed',
        default_rate: 1000, // $10.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true
      }, 'service_id');

      const creditService = await context.createEntity('service_catalog', {
        service_name: 'Credit Service',
        service_type: 'Fixed',
        default_rate: -200, // -$2.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true  // This is taxable but negative
      }, 'service_id');

      // Generate invoice with manual items including a discount
      const invoice = await generateManualInvoice({
        clientId: client_id,
        items: [
          {
            // Regular service item
            service_id: regularService,
            description: 'Regular Service',
            quantity: 1,
            rate: 1000
          },
          {
            // Credit service item
            service_id: creditService,
            description: 'Credit Service',
            quantity: 1,
            is_discount: false,
            rate: -200
          },
          {
            // Manual discount applied to regular service by service ID
            description: 'Manual Discount',
            quantity: 1,
            rate: -100,
            is_discount: true,
            discount_type: 'fixed',
            service_id: '',
            applies_to_service_id: regularService // Reference by service ID instead of item ID
          }
        ]
      });

      // Get invoice items to verify calculations
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: invoice!.invoice_id })
        .orderBy('net_amount', 'desc');

      // Verify service configurations were respected
      const services = await context.db('service_catalog')
        .whereIn('service_id', [regularService, creditService])
        .select('service_id', 'service_name', 'default_rate', 'is_taxable', 'tax_region');

      const regularServiceConfig = services.find(s => s.service_id === regularService);
      const creditServiceConfig = services.find(s => s.service_id === creditService);

      expect(regularServiceConfig?.is_taxable).toBe(true);
      expect(creditServiceConfig?.is_taxable).toBe(true);

      // Verify invoice totals
      expect(invoice!.subtotal).toBe(700);  // $7.00 (1000 - 200 - 100)
      expect(invoice!.tax).toBe(72);        // $0.72 (8.875% of $8.00 taxable base, rounded up)
      expect(invoice!.total_amount).toBe(772); // $7.72 (subtotal + tax)

      // Verify regular service item
      const regularItem = invoiceItems.find(item => item.service_id === regularService);
      expect(regularItem).toBeDefined();
      expect(parseInt(regularItem!.net_amount)).toBe(1000);
      expect(parseInt(regularItem!.tax_amount)).toBe(72); // Gets all tax since it's the only positive amount
      expect(regularItem!.is_taxable).toBe(true);
      expect(regularItem!.is_discount).toBe(false);
      expect(regularItem!.tax_region).toBe('US-NY');

      // Verify credit service item
      const creditItem = invoiceItems.find(item => item.service_id === creditService);
      expect(creditItem).toBeDefined();
      expect(parseInt(creditItem!.net_amount)).toBe(-200);
      expect(parseInt(creditItem!.tax_amount)).toBe(0);   // Negative amounts get no tax
      expect(creditItem!.is_taxable).toBe(true);         // Still taxable, but no tax due to negative amount
      expect(creditItem!.is_discount).toBe(false);       // Not a discount, just a negative amount
      expect(creditItem!.tax_region).toBe('US-NY');

      // Verify manual discount item
      const discountItem = invoiceItems.find(item => item.is_discount === true);
      expect(discountItem).toBeDefined();
      expect(parseInt(discountItem!.net_amount)).toBe(-100);
      expect(parseInt(discountItem!.tax_amount)).toBe(0);  // Discounts get no tax
      expect(discountItem!.is_taxable).toBe(false);       // Marked non-taxable in invoice item
      expect(discountItem!.is_discount).toBe(true);       // Properly marked as discount
      
      // Verify tax calculation logic
      const positiveItems = invoiceItems
        .filter(item => item.is_taxable && parseInt(item.net_amount) > 0);
      const creditItems = invoiceItems
        .filter(item => item.is_discount !== true && parseInt(item.net_amount) < 0);

      const positiveAmount = positiveItems
        .reduce((sum, item) => sum + parseInt(item.net_amount), 0);
      const creditAmount = creditItems
        .reduce((sum, item) => sum + Math.abs(parseInt(item.net_amount)), 0);

      const taxableBase = positiveAmount - creditAmount;
      expect(taxableBase).toBe(800); // Positive amounts (1000) minus credits (200)
      
      expect(invoice!.tax).toBe(72); // 8.875% of taxable base with proper rounding rules applied
    });
  });

  describe("Tax Calculation with Tax-Exempt Line Items", () => {
    it("should only calculate tax for taxable line items", async () => {
      // Create test client with tax settings
      const client_id = await context.createEntity('clients', {
        client_name: 'Tax Exempt Test Client',
        billing_cycle: 'monthly',
        client_id: uuidv4(),
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
      }, 'client_id');

      // Create NY tax rate (10%) and set as active
      const nyTaxRateId = await context.createEntity('tax_rates', {
        region: 'US-NY',
        tax_percentage: 10.0,
        description: 'NY Test Tax',
        start_date: '2025-01-01',
        is_active: true
      }, 'tax_rate_id');

      // Set up client tax settings
      await context.db('client_tax_settings').insert({
        client_id: client_id,
        tenant: context.tenantId,
        tax_rate_id: nyTaxRateId,
        is_reverse_charge_applicable: false
      });

      // Ensure tax rate is active
      await context.db('tax_rates')
        .where({ tax_rate_id: nyTaxRateId })
        .update({ is_active: true });

      // Create services with different tax settings
      const taxableService = await context.createEntity('service_catalog', {
        service_name: 'Taxable Service',
        service_type: 'Fixed',
        default_rate: 10000, // $100.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: true  // Explicitly set as taxable
      }, 'service_id');

      const nonTaxableService = await context.createEntity('service_catalog', {
        service_name: 'Non-Taxable Service',
        service_type: 'Fixed',
        default_rate: 5000, // $50.00
        unit_of_measure: 'unit',
        tax_region: 'US-NY',
        is_taxable: false  // Explicitly set as non-taxable
      }, 'service_id');

      // Verify services were created with correct tax settings
      const services = await context.db('service_catalog')
        .whereIn('service_id', [taxableService, nonTaxableService])
        .select('service_id', 'service_name', 'is_taxable', 'tax_region');

      console.log('Created services:', services);

      // Ensure tax settings are correct
      const taxableServiceDetails = services.find(s => s.service_id === taxableService);
      const nonTaxableServiceDetails = services.find(s => s.service_id === nonTaxableService);

      if (!taxableServiceDetails?.is_taxable) {
        throw new Error('Taxable service was not created with is_taxable=true');
      }
      if (nonTaxableServiceDetails?.is_taxable !== false) {
        throw new Error('Non-taxable service was not created with is_taxable=false');
      }

      // Create a contract line with both services
      const mixedTaxPlanId = await context.createEntity('contract_lines', {
        contract_line_name: 'Mixed Tax Plan',
        billing_frequency: 'monthly',
        is_custom: false,
        contract_line_type: 'Fixed'
      }, 'contract_line_id');

      // Assign services to plan
      await context.db('contract_line_services').insert([
        {
          contract_line_id: mixedTaxPlanId,
          service_id: taxableService,
          description: 'Primary taxable service',
          quantity: 1,
          rate: 10000
        },
        {
          contract_line_id: mixedTaxPlanId,
          service_id: nonTaxableService,
          quantity: 1,
          rate: -10000
        }
      ]);

      // Create billing cycle
      const mixedTaxBillingCycle = await context.createEntity('client_billing_cycles', {
        client_id: client_id,
        billing_cycle: 'monthly',
        effective_date: '2025-02-01',
        period_start_date: '2025-02-01',
        period_end_date: '2025-03-01'
      }, 'billing_cycle_id');

      // Assign plan to client
      await context.db('client_contract_lines').insert({
        client_contract_line_id: uuidv4(),
        client_id: client_id,
        contract_line_id: mixedTaxPlanId,
        start_date: '2025-02-01',
        is_active: true,
        tenant: context.tenantId
      });

      // Generate invoice
      const mixedTaxInvoice = await generateInvoice(mixedTaxBillingCycle);

      // Get invoice items to verify tax calculation
      const invoiceItems = await context.db('invoice_items')
        .where({ invoice_id: mixedTaxInvoice!.invoice_id })
        .orderBy('net_amount', 'desc');

      console.log('Invoice items:', invoiceItems);

      // Verify each service's tax calculation
      const taxableItem = invoiceItems.find(item => item.service_id === taxableService);
      const nonTaxableItem = invoiceItems.find(item => item.service_id === nonTaxableService);

      // Verify taxable service calculations
      expect(parseInt(taxableItem?.net_amount)).toBe(10000); // $100.00
      expect(parseInt(taxableItem?.tax_amount)).toBe(1000);  // $10.00 (10% tax)
      expect(parseInt(taxableItem?.total_price)).toBe(11000); // $110.00

      // Verify non-taxable service calculations
      expect(parseInt(nonTaxableItem?.net_amount)).toBe(5000);  // $50.00
      expect(parseInt(nonTaxableItem?.tax_amount)).toBe(0);     // No tax
      expect(parseInt(nonTaxableItem?.total_price)).toBe(5000); // $50.00

      // Verify overall invoice totals
      expect(mixedTaxInvoice!.subtotal).toBe(15000); // $150.00
      expect(mixedTaxInvoice!.tax).toBe(1000);       // $10.00 (only from taxable service)
      expect(mixedTaxInvoice!.total_amount).toBe(16000); // $160.00
    });
  });

  it('should verify total calculation when subtotal is positive but tax is zero', async () => {
    // Create test client with tax exempt status
    const client_id = await context.createEntity<IClient>('clients', {
      client_name: 'Tax Exempt Client',
      billing_cycle: 'monthly',
      client_id: uuidv4(),
      region_code: 'US-NY',
      is_tax_exempt: true, // Set client as tax exempt
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      is_inactive: false
    }, 'client_id');

    // Create NY tax rate (10% but won't be applied due to tax exempt status)
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0,
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up client tax settings
    await context.db('client_tax_settings').insert({
      client_id: client_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    expect(invoice.subtotal).toBe(0);
    expect(invoice.tax).toBe(1000);
    expect(invoice.total_amount).toBe(1000);

    // Create a contract line
    const planId = await context.createEntity('contract_lines', {
      contract_line_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed'
    }, 'contract_line_id');

    // Assign service to plan
    await context.db('contract_line_services').insert({
      contract_line_id: planId,
      service_id: service,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle
    const billingCycle = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    // Assign plan to client
    await context.db('client_contract_lines').insert({
      client_contract_line_id: uuidv4(),
      client_id: client_id,
      contract_line_id: planId,
      start_date: '2025-02-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);

    // Verify calculations:
    // - Service price: $100.00 (10000 cents)
    // - Tax: $0.00 (0 cents) because client is tax exempt
    // - Total: $100.00 (10000 cents)
    expect(invoice!.subtotal).toBe(10000); // $100.00
    expect(invoice!.tax).toBe(0);          // $0.00
    expect(invoice!.total_amount).toBe(10000); // $100.00

    // Additional verification
    expect(invoice!.subtotal).toBeGreaterThan(0); // Verify subtotal is positive
    expect(invoice!.tax).toBe(0);                 // Verify tax is exactly zero
    expect(invoice!.total_amount).toBe(invoice!.subtotal); // Verify total equals subtotal
  });

  it('should verify total calculation when subtotal and tax are both positive', async () => {
    // Create test client
    const client_id = await context.createEntity<IClient>('clients', {
      client_name: 'Basic Tax Test Client',
      billing_cycle: 'monthly',
      client_id: uuidv4(),
      region_code: 'US-NY',
      is_tax_exempt: false,
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString(),
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      is_inactive: false
    }, 'client_id');

    // Create NY tax rate (10% for easy calculation)
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 10.0,
      description: 'NY Test Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up client tax settings
    await context.db('client_tax_settings').insert({
      client_id: client_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create a service with a simple price for clear calculations
    const service = await context.createEntity('service_catalog', {
      service_name: 'Basic Service',
      service_type: 'Fixed',
      default_rate: 10000, // $100.00
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    // Create a contract line
    const planId = await context.createEntity('contract_lines', {
      contract_line_name: 'Basic Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      contract_line_type: 'Fixed'
    }, 'contract_line_id');

    // Assign service to plan
    await context.db('contract_line_services').insert({
      contract_line_id: planId,
      service_id: service,
      quantity: 1,
      tenant: context.tenantId
    });

    // Create billing cycle
    const billingCycle = await context.createEntity('client_billing_cycles', {
      client_id: client_id,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01'
    }, 'billing_cycle_id');

    // Assign plan to client
    await context.db('client_contract_lines').insert({
      client_contract_line_id: uuidv4(),
      client_id: client_id,
      contract_line_id: planId,
      start_date: '2025-02-01',
      is_active: true,
      tenant: context.tenantId
    });

    // Generate invoice
    const invoice = await generateInvoice(billingCycle);

    // Verify calculations:
    // - Service price: $100.00 (10000 cents)
    // - Tax rate: 10%
    // - Expected tax: $10.00 (1000 cents)
    // - Expected total: $110.00 (11000 cents)
    expect(invoice!.subtotal).toBe(10000); // $100.00
    expect(invoice!.tax).toBe(1000);       // $10.00
    expect(invoice!.total_amount).toBe(11000); // $110.00

    // Additional verification that both values are positive
    expect(invoice!.subtotal).toBeGreaterThan(0);
    expect(invoice!.tax).toBeGreaterThan(0);
  });
  
  it('should correctly handle different tax regions during invoice recalculation', async () => {
    // Create test client
    const client_id = await context.createEntity<IClient>('clients', {
      client_name: 'Tax Recalculation Test Client',
      billing_cycle: 'monthly',
      client_id: uuidv4(),
      region_code: 'US-NY', // Default tax region
      is_tax_exempt: false,
      phone_no: '',
      credit_balance: 0,
      email: '',
      url: '',
      address: '',
      is_inactive: false,
      created_at: Temporal.Now.plainDateISO().toString(),
      updated_at: Temporal.Now.plainDateISO().toString()
    }, 'client_id');

    // Create tax rates for different regions
    const nyTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-NY',
      tax_percentage: 8.875,
      description: 'NY State + City Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    const caTaxRateId = await context.createEntity('tax_rates', {
      region: 'US-CA',
      tax_percentage: 8.0,
      description: 'CA State Tax',
      start_date: '2025-01-01'
    }, 'tax_rate_id');

    // Set up client tax settings
    await context.db('client_tax_settings').insert({
      client_id: client_id,
      tenant: context.tenantId,
      tax_rate_id: nyTaxRateId,
      is_reverse_charge_applicable: false
    });

    // Create services with different tax regions
    const serviceNY = await context.createEntity('service_catalog', {
      service_name: 'NY Service',
      service_type: 'Fixed',
      default_rate: 1000,
      unit_of_measure: 'unit',
      tax_region: 'US-NY',
      is_taxable: true
    }, 'service_id');

    const serviceCA = await context.createEntity('service_catalog', {
      service_name: 'CA Service',
      service_type: 'Fixed',
      default_rate: 500,
      unit_of_measure: 'unit',
      tax_region: 'US-CA',
      is_taxable: true
    }, 'service_id');

    // Create initial invoice with NY service
    const initialInvoice = await generateManualInvoice({
      clientId: client_id,
      items: [{
        service_id: serviceNY,
        quantity: 1,
        description: 'NY Service Item',
        rate: 1000
      }]
    });

    // Get invoice ID
    const invoiceId = initialInvoice.invoice_id;

    // Verify initial calculations
    expect(initialInvoice.subtotal).toBe(1000);
    expect(initialInvoice.tax).toBe(89); // 8.875% of 1000 = 88.75, rounded to 89

    // Set up for recalculation by ensuring dates are in a format that Temporal.PlainDate.from() can parse
    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    await context.db('invoices')
      .where({ invoice_id: invoiceId })
      .update({
        invoice_date: today,
        due_date: today
      });

    // Update invoice by adding a CA service item
    const billingEngine = new BillingEngine();
    
    // First update the invoice items
    await context.db('invoice_items').where({ invoice_id: invoiceId }).delete();
    
    // Insert both the NY and CA items
    await context.db('invoice_items').insert([
      {
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: serviceNY,
        description: 'NY Service Item',
        quantity: 1,
        unit_price: 1000,
        net_amount: 1000,
        tax_amount: 0, // Will be recalculated
        tax_rate: 0,   // Will be recalculated
        tax_region: 'US-NY',
        is_taxable: true,
        is_discount: false,
        total_price: 1000,
        tenant: context.tenantId,
        created_at: new Date().toISOString(),
        created_by: 'test'
      },
      {
        item_id: uuidv4(),
        invoice_id: invoiceId,
        service_id: serviceCA,
        description: 'CA Service Item',
        quantity: 1,
        unit_price: 500,
        net_amount: 500,
        tax_amount: 0, // Will be recalculated
        tax_rate: 0,   // Will be recalculated
        tax_region: 'US-CA',
        is_taxable: true,
        is_discount: false,
        total_price: 500,
        tenant: context.tenantId,
        created_at: new Date().toISOString(),
        created_by: 'test'
      }
    ]);
    
    // Trigger recalculation
    await billingEngine.recalculateInvoice(invoiceId);
    
    // Fetch updated invoice
    const updatedInvoice = await context.db('invoices')
      .where({ invoice_id: invoiceId })
      .first();
      
    // Fetch updated items
    const updatedItems = await context.db('invoice_items')
      .where({ invoice_id: invoiceId })
      .orderBy('created_at', 'asc');

    expect(items).toHaveLength(2);
    const taxableItem = items.find((item) => item.service_id === taxableService)!;
    const discountItem = items.find((item) => item.service_id === discountService)!;

    expect(Number(taxableItem.net_amount)).toBe(10000);
    expect(Number(taxableItem.tax_amount)).toBe(1000);
    expect(Number(discountItem.net_amount)).toBe(-10000);
    expect(Number(discountItem.tax_amount)).toBe(0);
  });

  it('distributes tax across services from different regions', async () => {
    // Ensure California tax rate exists (7.25%)
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-CA',
      regionName: 'California',
      description: 'CA State Tax',
      taxPercentage: 7.25,
      startDate: '2025-01-01T00:00:00.000Z'
    });

    const nyService = await createTestService(context, {
      service_name: 'NY Service',
      default_rate: 10000,
      tax_region: 'US-NY'
    });

    const caService = await createTestService(context, {
      service_name: 'CA Service',
      default_rate: 20000,
      tax_region: 'US-CA'
    });

    await assignServiceTaxRate(context, caService, 'US-CA');

    const { planId } = await createFixedPlanAssignment(context, nyService, {
      planName: 'Multi Region Plan',
      baseRateCents: 30000,
      detailBaseRateCents: 10000,
      startDate: '2025-02-01'
    });

    await addServiceToFixedPlan(context, planId, caService, { detailBaseRateCents: 20000 });

    const billingCycle = await context.createEntity('client_billing_cycles', {
      client_id: context.clientId,
      billing_cycle: 'monthly',
      effective_date: '2025-02-01',
      period_start_date: '2025-02-01',
      period_end_date: '2025-03-01',
      tenant: context.tenantId
    }, 'billing_cycle_id');

    const invoice = await generateInvoice(billingCycle);

    expect(invoice).not.toBeNull();

    const nyServiceRecord = await context.db('service_catalog')
      .where({ tenant: context.tenantId, service_id: nyService })
      .first('tax_rate_id');

    const caServiceRecord = await context.db('service_catalog')
      .where({ tenant: context.tenantId, service_id: caService })
      .first('tax_rate_id');

    const nyRate = nyServiceRecord?.tax_rate_id
      ? await context.db('tax_rates')
          .where({ tenant: context.tenantId, tax_rate_id: nyServiceRecord.tax_rate_id })
          .first('tax_percentage')
      : null;

    const caRate = caServiceRecord?.tax_rate_id
      ? await context.db('tax_rates')
          .where({ tenant: context.tenantId, tax_rate_id: caServiceRecord.tax_rate_id })
          .first('tax_percentage')
      : null;

    const nyTaxPercent = nyRate ? Number(nyRate.tax_percentage) : 0;
    const caTaxPercent = caRate ? Number(caRate.tax_percentage) : 0;

    const expectedNyTax = Math.round(10000 * (nyTaxPercent / 100));
    const theoreticalCaTax = Math.round(20000 * (caTaxPercent / 100));
    const actualCaTax = invoice!.tax - expectedNyTax;

    expect(invoice!.tax).toBeGreaterThan(expectedNyTax);
    expect(actualCaTax).toBeGreaterThan(0);
    expect(actualCaTax).toBeLessThanOrEqual(theoreticalCaTax);

    const expectedTaxTotal = expectedNyTax + actualCaTax;

    const items = await context.db('invoice_items')
      .where({ invoice_id: invoice!.invoice_id, tenant: context.tenantId })
      .orderBy('created_at', 'asc');

    expect(items).toHaveLength(1);
    expect(Number(items[0].tax_amount)).toBe(expectedTaxTotal);
  });
});
