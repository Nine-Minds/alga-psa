import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { generateManualInvoice, updateManualInvoice } from 'server/src/lib/actions/manualInvoiceActions';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder } from 'util';
import { TestContext } from '../../../test-utils/testContext';
import { setupCommonMocks } from '../../../test-utils/testMocks';
import { expectError, expectNotFound } from '../../../test-utils/errorUtils';

global.TextEncoder = TextEncoder;

// Create test context helpers
const { beforeAll: setupContext, beforeEach: resetContext, afterAll: cleanupContext } = TestContext.createHelpers();

let context: TestContext;

beforeAll(async () => {
  // Initialize test context and set up mocks
  context = await setupContext({
    cleanupTables: ['service_catalog', 'tax_rates', 'company_tax_settings', 'transactions']
  });
  setupCommonMocks({ tenantId: context.tenantId });
});

beforeEach(async () => {
  await resetContext();
});

afterAll(async () => {
  await cleanupContext();
});

/**
 * Helper to create a test service
 */
async function createTestService(overrides = {}) {
  const serviceId = uuidv4();
  const defaultService = {
    service_id: serviceId,
    tenant: context.tenantId,
    service_name: 'Test Service',
    service_type: 'Fixed',
    default_rate: 1000,
    unit_of_measure: 'each',
    is_taxable: true,
    tax_region: 'US-NY'
  };

  await context.db('service_catalog').insert({ ...defaultService, ...overrides });
  return serviceId;
}

/**
 * Helper to set up tax configuration
 */
async function setupTaxConfiguration() {
  const taxRateId = uuidv4();
  await context.db('tax_rates').insert({
    tax_rate_id: taxRateId,
    tenant: context.tenantId,
    region: 'US-NY',
    tax_percentage: 8.875,
    description: 'NY State + City Tax',
    start_date: '2025-02-22T00:00:00.000Z'
  });

  await context.db('company_tax_settings').insert({
    company_id: context.companyId,
    tenant: context.tenantId,
    tax_rate_id: taxRateId,
    is_reverse_charge_applicable: false
  });

  return taxRateId;
}

describe('Manual Invoice Generation', () => {
  describe('Basic Invoice Creation', () => {
    it('creates a manual invoice with single line item', async () => {
      const serviceId = await createTestService();
      await setupTaxConfiguration();

      const result = await generateManualInvoice({
        companyId: context.companyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Test Service Item',
          rate: 1000
        }]
      });

      expect(result).toMatchObject({
        company_id: context.companyId,
        invoice_number: expect.stringMatching(/^TIC\d{6}$/),
        status: 'draft'
      });

      expect(result.subtotal).toBe(1000);
      expect(result.tax).toBe(89); // 8.88% of 1000 = 88.80, rounded up
      expect(result.total_amount).toBe(1089);
    });

    it('creates a manual invoice with multiple line items', async () => {
      const service1Id = await createTestService();
      const service2Id = await createTestService({ service_name: 'Second Service' });
      await setupTaxConfiguration();

      const result = await generateManualInvoice({
        companyId: context.companyId,
        items: [
          {
            service_id: service1Id,
            quantity: 2,
            description: 'First Service Item',
            rate: 1000
          },
          {
            service_id: service2Id,
            quantity: 1,
            description: 'Second Service Item',
            rate: 500
          }
        ]
      });

      expect(result.subtotal).toBe(2500); // (2 * 1000) + (1 * 500)
      expect(result.tax).toBe(223); // 8.88% of 2500 = 223.00
      expect(result.total_amount).toBe(2723);
    });

    it('calculates correct subtotal with mixed positive and negative line items', async () => {
      const serviceId = await createTestService();
      await setupTaxConfiguration();

      const result = await generateManualInvoice({
        companyId: context.companyId,
        items: [
          {
            service_id: serviceId,
            quantity: 1,
            description: 'Service Charge',
            rate: 1000
          },
          {
            service_id: '',
            quantity: 1,
            description: 'Discount',
            is_discount: true,
            applies_to_service_id: serviceId,
            rate: -200
          },
          {
            service_id: serviceId,
            quantity: 2,
            description: 'Additional Service',
            rate: 500
          },
          {
            service_id: serviceId,
            quantity: 1,
            description: 'Refund',
            is_discount: false,
            rate: -300
          }
        ]
      });

      // Subtotal calculation:
      // Service Charge: 1 * 1000 = 1000
      // Discount: 1 * -200 = -200
      // Additional Service: 2 * 500 = 1000
      // Refund: 1 * -300 = -300
      // Total: 1000 - 200 + 1000 - 300 = 1500
      expect(result.subtotal).toBe(1500);
      
      // Tax should be calculated on the net positive amount:
      // Net amount before tax: 1500 (1000 - 200 + 1000 - 300)
      // Tax: 8.88% of 1500 = 133.20, rounded up to 133
      expect(result.tax).toBe(151); // 8.875% of 1700 = 150.88, rounded up
      expect(result.total_amount).toBe(1651); // 1500 + 134
    });
  });

  describe('Validation and Error Handling', () => {
    it('rejects invalid company IDs', async () => {
      const serviceId = await createTestService();
      const invalidCompanyId = uuidv4();
      
      await expectNotFound(
        () => generateManualInvoice({
          companyId: invalidCompanyId,
          items: [{
            service_id: serviceId,
            quantity: 1,
            description: 'Test Service',
            rate: 1000
          }]
        }),
        'Company'
      );
    });

    it('rejects invalid service IDs', async () => {
      const invalidServiceId = uuidv4();
      
      await expectNotFound(
        () => generateManualInvoice({
          companyId: context.companyId,
          items: [{
            service_id: invalidServiceId,
            quantity: 1,
            description: 'Test Service',
            rate: 1000
          }]
        }),
        'Service'
      );
    });
  });

  describe('Tax Calculations', () => {
    it('applies correct tax rates based on region', async () => {
      const serviceId = await createTestService();
      const taxRateId = await setupTaxConfiguration();

      // Update tax rate to a different percentage
      await context.db('tax_rates')
        .where({ tax_rate_id: taxRateId })
        .update({ tax_percentage: 10 });

      const result = await generateManualInvoice({
        companyId: context.companyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Test Service',
          rate: 1000
        }]
      });

      expect(result.tax).toBe(100); // 10% of 1000
      expect(result.total_amount).toBe(1100);
    });

    it('handles tax exempt companies correctly', async () => {
      const serviceId = await createTestService();
      await setupTaxConfiguration();
  
      // Make company tax exempt
      await context.db('companies')
        .where({ company_id: context.companyId })
        .update({ is_tax_exempt: true });
  
      const result = await generateManualInvoice({
        companyId: context.companyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Test Service',
          rate: 1000
        }]
      });
  
      expect(result.tax).toBe(0);
      expect(result.total_amount).toBe(1000);
    });
  
    it('calculates tax accurately when line items have different tax rates', async () => {
      // Create two services: one for US-NY and one for US-CA
      const serviceNY = await createTestService(); // defaults to tax_region 'US-NY'
      const serviceCA = await createTestService({ service_name: 'Second Service', tax_region: 'US-CA' });
      
      // Set up tax configuration for both regions
      const taxRateNyId = uuidv4();
      await context.db('tax_rates').insert([{
         tax_rate_id: taxRateNyId,
         tenant: context.tenantId,
         region: 'US-NY',
         tax_percentage: 8.875,
         description: 'NY Tax',
         start_date: '2025-02-22T00:00:00.000Z'
      }, {
         tax_rate_id: uuidv4(),
         tenant: context.tenantId,
         region: 'US-CA',
         tax_percentage: 8.0,
         description: 'CA Tax',
         start_date: '2025-02-22T00:00:00.000Z'
      }]);
      
      // First remove any existing tax settings for this company
      await context.db('company_tax_settings')
        .where({ company_id: context.companyId, tenant: context.tenantId })
        .delete();
        
      // Set up company tax settings with default NY rate
      await context.db('company_tax_settings').insert({
         company_id: context.companyId,
         tenant: context.tenantId,
         tax_rate_id: taxRateNyId,
         is_reverse_charge_applicable: false
      });
      
      // Generate an invoice with one item from each service
      const result = await generateManualInvoice({
         companyId: context.companyId,
         items: [
           {
             service_id: serviceNY,
             quantity: 1,
             description: 'NY Service Item',
             rate: 1000
           },
           {
             service_id: serviceCA,
             quantity: 1,
             description: 'CA Service Item',
             rate: 500
           }
         ]
      });
      
      // Expected totals:
      // Subtotal: 1000 + 500 = 1500
      // Tax: For NY: ~1000 * 8.875% ≈ 88.75 rounded to 89, and for CA: 500 * 8% = 40, total = 129
      // Total: 1500 + 129 = 1629
      expect(result.subtotal).toBe(1500);
      expect(result.tax).toBe(129);
      expect(result.total_amount).toBe(1629);
    });
  });

  describe('Transaction Recording', () => {
    it('creates appropriate transaction records', async () => {
      const serviceId = await createTestService();
      await setupTaxConfiguration();

      const result = await generateManualInvoice({
        companyId: context.companyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Test Service',
          rate: 1000
        }]
      });

      const transactions = await context.db('transactions')
        .where({ 
          invoice_id: result.invoice_id,
          tenant: context.tenantId
        });

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        company_id: context.companyId,
        type: 'invoice_generated',
        status: 'completed',
        amount: 1089 // Including tax
      });
    });
  });

  describe('Invoice Adjustments', () => {
    it('correctly updates an invoice when new manual items are added', async () => {
      // 1. Set up test services and tax configuration
      const serviceId = await createTestService();
      await setupTaxConfiguration();

      // 2. Create initial invoice with one item
      const initialInvoice = await generateManualInvoice({
        companyId: context.companyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Initial Service Item',
          rate: 1000
        }]
      });

      // 3. Verify initial state
      expect(initialInvoice.subtotal).toBe(1000);
      expect(initialInvoice.tax).toBe(89); // 8.875% of 1000, rounded
      expect(initialInvoice.total_amount).toBe(1089);
      expect(initialInvoice.invoice_items).toHaveLength(1);

      // Extract the invoice ID for later use
      const invoiceId = initialInvoice.invoice_id;
      
      // 4. Ensure the invoice dates are stored in a format that Temporal.PlainDate.from() can parse
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      await context.db('invoices')
        .where({ invoice_id: invoiceId })
        .update({
          invoice_date: today,
          due_date: today
        });
      
      // 5. Update the invoice with new items
      const updatedInvoice = await updateManualInvoice(invoiceId, {
        companyId: context.companyId,
        items: [
          // Include the original item
          {
            service_id: serviceId,
            quantity: 1,
            description: 'Initial Service Item',
            rate: 1000
          },
          // Add a new service item
          {
            service_id: serviceId,
            quantity: 2,
            description: 'Additional Service',
            rate: 500
          }
        ]
      });

      // 5. Verify updated state
      // New subtotal: 1000 (original) + (2 * 500) = 2000
      expect(updatedInvoice.subtotal).toBe(2000);
      // New tax: 8.875% of 2000 = 177.5, rounded to 178
      expect(updatedInvoice.tax).toBe(178);
      expect(parseInt(updatedInvoice.total_amount.toString())).toBe(2178);
      expect(updatedInvoice.invoice_items).toHaveLength(2);

      // 6. Verify transaction records are updated
      const transactions = await context.db('transactions')
        .where({
          invoice_id: initialInvoice.invoice_id,
          tenant: context.tenantId
        })
        .orderBy('created_at', 'desc');

      expect(transactions).toHaveLength(2);
      
      // Find the invoice_adjustment transaction instead of assuming its array position
      const adjustmentTransaction = transactions.find(t => t.type === 'invoice_adjustment');
      expect(adjustmentTransaction).toBeDefined();
      expect(adjustmentTransaction).toMatchObject({
        company_id: context.companyId,
        type: 'invoice_adjustment',
        status: 'completed',
        amount: 2178 // Updated amount including tax
      });
    });

    it('correctly handles mixed items including discounts when adding new items', async () => {
      // 1. Set up test service
      const serviceId = await createTestService();
      await setupTaxConfiguration();

      // 2. Create initial invoice with one item
      const initialInvoice = await generateManualInvoice({
        companyId: context.companyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Initial Service Item',
          rate: 1000
        }]
      });

      // 3. Get invoice ID for the update operation
      const invoiceId = initialInvoice.invoice_id;

      // 4. Ensure the invoice dates are stored in a format that Temporal.PlainDate.from() can parse
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      await context.db('invoices')
        .where({ invoice_id: invoiceId })
        .update({
          invoice_date: today,
          due_date: today
        });

      // 5. Update the invoice with a mix of items including a discount
      const updatedInvoice = await updateManualInvoice(invoiceId, {
        companyId: context.companyId,
        items: [
          // Include the original item
          {
            service_id: serviceId,
            quantity: 1,
            description: 'Initial Service Item',
            rate: 1000
          },
          // Add a new service item
          {
            service_id: serviceId,
            quantity: 2,
            description: 'Additional Service',
            rate: 500
          },
          // Add a discount item
          {
            service_id: '',
            quantity: 1,
            description: 'Discount',
            is_discount: true,
            applies_to_service_id: serviceId,
            rate: -300
          }
        ]
      });

      // 4. Verify updated state
      // Subtotal calculation:
      // Initial item: 1 * 1000 = 1000
      // Additional service: 2 * 500 = 1000
      // Discount: 1 * -300 = -300
      // Total: 1000 + 1000 - 300 = 1700
      expect(updatedInvoice.subtotal).toBe(1700);
      
      // Tax should be calculated on pre-discount amount
      // for positive items only: 1000 + 1000 = 2000
      // Tax: 8.875% of 2000 = 177.5, rounded to 178
      expect(updatedInvoice.tax).toBe(178);
      expect(updatedInvoice.total_amount).toBe(1878); // 1700 + 178
      expect(updatedInvoice.invoice_items).toHaveLength(3);
    });

    it('correctly handles different tax regions when adding new items', async () => {
      // 1. Create services with different tax regions
      const serviceNY = await createTestService(); // defaults to tax_region 'US-NY'
      const serviceCA = await createTestService({
        service_name: 'California Service',
        tax_region: 'US-CA'
      });
      
      // 2. Set up multi-region tax configuration
      const taxRateNyId = uuidv4();
      await context.db('tax_rates').insert([{
        tax_rate_id: taxRateNyId,
        tenant: context.tenantId,
        region: 'US-NY',
        tax_percentage: 8.875,
        description: 'NY Tax',
        start_date: '2025-02-22T00:00:00.000Z'
      }, {
        tax_rate_id: uuidv4(),
        tenant: context.tenantId,
        region: 'US-CA',
        tax_percentage: 8.0,
        description: 'CA Tax',
        start_date: '2025-02-22T00:00:00.000Z'
      }]);
      
      // First remove any existing tax settings for this company
      await context.db('company_tax_settings')
        .where({ company_id: context.companyId, tenant: context.tenantId })
        .delete();
        
      // Set up company tax settings with default NY rate
      await context.db('company_tax_settings').insert({
        company_id: context.companyId,
        tenant: context.tenantId,
        tax_rate_id: taxRateNyId,
        is_reverse_charge_applicable: false
      });
      
      // 3. Create initial invoice with NY service
      const initialInvoice = await generateManualInvoice({
        companyId: context.companyId,
        items: [{
          service_id: serviceNY,
          quantity: 1,
          description: 'NY Service Item',
          rate: 1000
        }]
      });
      
      // Get invoice ID for the update operation
      const invoiceId = initialInvoice.invoice_id;
      
      // 4. Ensure the invoice dates are stored in a format that Temporal.PlainDate.from() can parse
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      await context.db('invoices')
        .where({ invoice_id: invoiceId })
        .update({
          invoice_date: today,
          due_date: today
        });
      
      // 5. Update invoice by adding a CA service item
      const updatedInvoice = await updateManualInvoice(invoiceId, {
        companyId: context.companyId,
        items: [
          // Include the original NY item
          {
            service_id: serviceNY,
            quantity: 1,
            description: 'NY Service Item',
            rate: 1000
          },
          // Add a CA service item
          {
            service_id: serviceCA,
            quantity: 1,
            description: 'CA Service Item',
            rate: 500
          }
        ]
      });
      
      // 5. Verify updated calculations
      // Subtotal: 1000 + 500 = 1500
      expect(updatedInvoice.subtotal).toBe(1500);
      
      // Tax:
      // NY: 1000 * 8.875% = 88.75, rounded to 89
      // CA: 500 * 8% = 40
      // Total tax: 89 + 40 = 129
      expect(updatedInvoice.tax).toBe(129);
      expect(updatedInvoice.total_amount).toBe(1629); // 1500 + 129
      expect(updatedInvoice.invoice_items).toHaveLength(2);
      
      // 6. Verify each item has the correct tax amount
      const nyItem = updatedInvoice.invoice_items.find(item =>
        item.description === 'NY Service Item');
      const caItem = updatedInvoice.invoice_items.find(item =>
        item.description === 'CA Service Item');
        
      expect(nyItem?.tax_amount).toBe(89);
      expect(caItem?.tax_amount).toBe(40);
    });
    
    it('correctly updates an invoice when existing items are modified', async () => {
      // 1. Set up test service and tax configuration
      const serviceId = await createTestService();
      await setupTaxConfiguration();

      // 2. Create initial invoice with one item
      const initialInvoice = await generateManualInvoice({
        companyId: context.companyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Initial Service Item',
          rate: 1000
        }]
      });

      // 3. Verify initial state
      expect(initialInvoice.subtotal).toBe(1000);
      expect(initialInvoice.tax).toBe(89); // 8.875% of 1000, rounded
      expect(initialInvoice.total_amount).toBe(1089);
      expect(initialInvoice.invoice_items).toHaveLength(1);

      // Extract the invoice ID for later use
      const invoiceId = initialInvoice.invoice_id;
      
      // 4. Ensure the invoice dates are stored in a format that Temporal.PlainDate.from() can parse
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      await context.db('invoices')
        .where({ invoice_id: invoiceId })
        .update({
          invoice_date: today,
          due_date: today
        });
      
      // 5. Update the invoice by modifying the existing item (changing quantity and rate)
      const updatedInvoice = await updateManualInvoice(invoiceId, {
        companyId: context.companyId,
        items: [
          // Same item but with modified quantity and rate
          {
            service_id: serviceId,
            quantity: 2, // Changed from 1 to 2
            description: 'Initial Service Item (Modified)',
            rate: 1500 // Changed from 1000 to 1500
          }
        ]
      });

      // 6. Verify updated state
      // New subtotal: 2 * 1500 = 3000
      expect(updatedInvoice.subtotal).toBe(3000);
      // New tax: 8.875% of 3000 = 266.25, rounded up to 267
      expect(updatedInvoice.tax).toBe(267);
      expect(updatedInvoice.total_amount).toBe(3267);
      expect(updatedInvoice.invoice_items).toHaveLength(1); // Still just one item
      
      // Verify the item was actually modified
      const modifiedItem = updatedInvoice.invoice_items[0];
      expect(modifiedItem.quantity).toBeCloseTo(2);
      expect(modifiedItem.rate).toBe(1500);
      expect(modifiedItem.description).toBe('Initial Service Item (Modified)');

      // 7. Verify transaction records are updated
      const transactions = await context.db('transactions')
        .where({
          invoice_id: initialInvoice.invoice_id,
          tenant: context.tenantId
        })
        .orderBy('created_at', 'desc');

      expect(transactions).toHaveLength(2);
      
      // Find the invoice_adjustment transaction
      const adjustmentTransaction = transactions.find(t => t.type === 'invoice_adjustment');
      expect(adjustmentTransaction).toBeDefined();
      expect(adjustmentTransaction).toMatchObject({
        company_id: context.companyId,
        type: 'invoice_adjustment',
        status: 'completed',
        amount: 3267 // Updated amount including tax (with tax rounded up)
      });
    });
    
    it('validates manual item adjustments when items are removed', async () => {
      // 1. Set up test services and tax configuration
      const service1Id = await createTestService({ service_name: 'First Service' });
      const service2Id = await createTestService({ service_name: 'Second Service' });
      await setupTaxConfiguration();

      // 2. Create initial invoice with multiple items
      const initialInvoice = await generateManualInvoice({
        companyId: context.companyId,
        items: [
          {
            service_id: service1Id,
            quantity: 1,
            description: 'First Service Item',
            rate: 1000
          },
          {
            service_id: service2Id,
            quantity: 2,
            description: 'Second Service Item',
            rate: 500
          }
        ]
      });

      // 3. Verify initial state
      expect(initialInvoice.subtotal).toBe(2000); // 1000 + (2 * 500)
      expect(initialInvoice.tax).toBe(178); // 8.875% of 2000 = 177.5, rounded up to 178
      expect(initialInvoice.total_amount).toBe(2178);
      expect(initialInvoice.invoice_items).toHaveLength(2);

      // Extract the invoice ID for later use
      const invoiceId = initialInvoice.invoice_id;
      
      // 4. Ensure the invoice dates are stored in a format that Temporal.PlainDate.from() can parse
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      await context.db('invoices')
        .where({ invoice_id: invoiceId })
        .update({
          invoice_date: today,
          due_date: today
        });
      
      // 5. Update the invoice by removing one item (the second service)
      const updatedInvoice = await updateManualInvoice(invoiceId, {
        companyId: context.companyId,
        items: [
          // Only include the first item, effectively removing the second item
          {
            service_id: service1Id,
            quantity: 1,
            description: 'First Service Item',
            rate: 1000
          }
        ]
      });

      // 6. Verify updated state after item removal
      expect(updatedInvoice.subtotal).toBe(1000); // Only the first item remains
      expect(updatedInvoice.tax).toBe(89); // 8.875% of 1000 = 88.75, rounded up to 89
      expect(updatedInvoice.total_amount).toBe(1089);
      expect(updatedInvoice.invoice_items).toHaveLength(1); // One item has been removed
      
      // Verify the correct item was kept
      expect(updatedInvoice.invoice_items[0].description).toBe('First Service Item');
      expect(updatedInvoice.invoice_items[0].rate).toBe(1000);

      // 7. Verify transaction records are updated
      const transactions = await context.db('transactions')
        .where({
          invoice_id: initialInvoice.invoice_id,
          tenant: context.tenantId
        })
        .orderBy('created_at', 'desc');

      expect(transactions).toHaveLength(2);
      
      // Find the invoice_adjustment transaction
      const adjustmentTransaction = transactions.find(t => t.type === 'invoice_adjustment');
      expect(adjustmentTransaction).toBeDefined();
      expect(adjustmentTransaction).toMatchObject({
        company_id: context.companyId,
        type: 'invoice_adjustment',
        status: 'completed',
        amount: 1089 // Updated amount after item removal
      });      
    });

    it('tests manual item adjustments affecting tax calculation', async () => {
      // 1. Set up test services with different tax configurations
      const taxableServiceId = await createTestService({
        service_name: 'Taxable Service',
        is_taxable: true
      });
      const nonTaxableServiceId = await createTestService({
        service_name: 'Non-Taxable Service',
        is_taxable: false
      });
      
      // Service with different tax region
      const caServiceId = await createTestService({
        service_name: 'California Service',
        tax_region: 'US-CA'
      });
      
      // Set up tax configuration for NY and CA regions
      const taxRateNyId = uuidv4();
      await context.db('tax_rates').insert([{
        tax_rate_id: taxRateNyId,
        tenant: context.tenantId,
        region: 'US-NY',
        tax_percentage: 8.875, // NY tax rate
        description: 'NY Tax',
        start_date: '2025-02-22T00:00:00.000Z'
      }, {
        tax_rate_id: uuidv4(),
        tenant: context.tenantId,
        region: 'US-CA',
        tax_percentage: 7.25, // CA tax rate
        description: 'CA Tax',
        start_date: '2025-02-22T00:00:00.000Z'
      }]);
      
      // First remove any existing tax settings
      await context.db('company_tax_settings')
        .where({ company_id: context.companyId, tenant: context.tenantId })
        .delete();
        
      // Set up company tax settings with default NY rate
      await context.db('company_tax_settings').insert({
        company_id: context.companyId,
        tenant: context.tenantId,
        tax_rate_id: taxRateNyId,
        is_reverse_charge_applicable: false
      });

      // 2. Create initial invoice with a mix of taxable and non-taxable items
      const initialInvoice = await generateManualInvoice({
        companyId: context.companyId,
        items: [
          // Taxable NY service
          {
            service_id: taxableServiceId,
            quantity: 1,
            description: 'Taxable NY Item',
            rate: 1000
          },
          // Non-taxable service
          {
            service_id: nonTaxableServiceId,
            quantity: 1,
            description: 'Non-Taxable Item',
            rate: 500
          }
        ]
      });

      // 3. Verify initial state - tax should only be on the taxable item
      expect(initialInvoice.subtotal).toBe(1500); // 1000 + 500
      expect(initialInvoice.tax).toBe(89); // 8.875% of 1000 = 88.75, rounded up to 89
      expect(initialInvoice.total_amount).toBe(1589);
      expect(initialInvoice.invoice_items).toHaveLength(2);
      
      // Verify individual item tax amounts
      const initialTaxableItem = initialInvoice.invoice_items.find(i => i.description === 'Taxable NY Item');
      const initialNonTaxableItem = initialInvoice.invoice_items.find(i => i.description === 'Non-Taxable Item');
      expect(initialTaxableItem?.tax_amount).toBe(89);
      expect(initialNonTaxableItem?.tax_amount).toBe(0);

      // Get invoice ID for the update operation
      const invoiceId = initialInvoice.invoice_id;
      
      // Format dates for Temporal compatibility
      const today = new Date().toISOString().split('T')[0];
      await context.db('invoices')
        .where({ invoice_id: invoiceId })
        .update({
          invoice_date: today,
          due_date: today
        });
      
      // 4. First adjustment: Change tax region of the taxable item
      const regionChangeInvoice = await updateManualInvoice(invoiceId, {
        companyId: context.companyId,
        items: [
          // Change the tax region by using the CA service instead
          {
            service_id: caServiceId, // Using CA service instead of NY
            quantity: 1,
            description: 'Taxable CA Item (was NY)',
            rate: 1000
          },
          // Keep the non-taxable item the same
          {
            service_id: nonTaxableServiceId,
            quantity: 1,
            description: 'Non-Taxable Item',
            rate: 500
          }
        ]
      });
      
      // 5. Verify tax calculation after changing tax region
      expect(regionChangeInvoice.subtotal).toBe(1500); // Same as before
      expect(regionChangeInvoice.tax).toBe(73); // 7.25% of 1000 = 72.5, rounded up to 73
      expect(regionChangeInvoice.total_amount).toBe(1573);
      
      // Verify individual item tax amounts
      const regionChangeTaxableItem = regionChangeInvoice.invoice_items.find(i =>
        i.description === 'Taxable CA Item (was NY)');
      expect(regionChangeTaxableItem?.tax_amount).toBe(73);
      
      // 6. Second adjustment: Convert non-taxable item to taxable, and vice versa
      const taxStatusChangeInvoice = await updateManualInvoice(invoiceId, {
        companyId: context.companyId,
        items: [
          // Change previously taxable item to use non-taxable service
          {
            service_id: nonTaxableServiceId,
            quantity: 1,
            description: 'Now Non-Taxable Item',
            rate: 1000
          },
          // Change previously non-taxable item to use taxable service
          {
            service_id: taxableServiceId,
            quantity: 1,
            description: 'Now Taxable Item',
            rate: 500
          }
        ]
      });
      
      // 7. Verify tax calculation after switching tax status
      expect(taxStatusChangeInvoice.subtotal).toBe(1500); // Same as before
      expect(taxStatusChangeInvoice.tax).toBe(45); // 8.875% of 500 = 44.375, rounded up to 45
      expect(taxStatusChangeInvoice.total_amount).toBe(1545);
      
      // Verify individual item tax amounts
      const nowNonTaxableItem = taxStatusChangeInvoice.invoice_items.find(i =>
        i.description === 'Now Non-Taxable Item');
      const nowTaxableItem = taxStatusChangeInvoice.invoice_items.find(i =>
        i.description === 'Now Taxable Item');
      expect(nowNonTaxableItem?.tax_amount).toBe(0);
      expect(nowTaxableItem?.tax_amount).toBe(45);
      
      // 8. Third adjustment: Add a discount that affects tax calculation
      const discountAdjustmentInvoice = await updateManualInvoice(invoiceId, {
        companyId: context.companyId,
        items: [
          // Keep the taxable item
          {
            service_id: taxableServiceId,
            quantity: 2, // Double the quantity
            description: 'Taxable Item',
            rate: 1000 // Double the rate
          },
          // Add a discount (which should not reduce the taxable base)
          {
            service_id: '',
            quantity: 1,
            description: 'Discount',
            is_discount: true,
            applies_to_service_id: taxableServiceId,
            rate: -500
          }
        ]
      });
      
      // 9. Verify tax calculation with discount
      // Subtotal: (2 * 1000) + (-500) = 1500
      expect(discountAdjustmentInvoice.subtotal).toBe(1500);
      
      // Tax should be calculated on the full pre-discount amount: 8.875% of 2000 = 177.5, rounded up to 178
      // This is because discounts don't reduce the taxable base per the tax allocation strategy
      expect(discountAdjustmentInvoice.tax).toBe(178);
      expect(discountAdjustmentInvoice.total_amount).toBe(1678);
      
      // Verify discount doesn't have tax
      const discountItem = discountAdjustmentInvoice.invoice_items.find(i =>
        i.description === 'Discount');
      expect(discountItem?.is_discount).toBe(true);
      expect(discountItem?.tax_amount).toBe(0);
      
      // 10. Verify transaction records are updated
      const transactions = await context.db('transactions')
        .where({
          invoice_id: initialInvoice.invoice_id,
          tenant: context.tenantId
        })
        .orderBy('created_at', 'desc');

      // Should have one invoice_generated and three invoice_adjustment transactions
      expect(transactions).toHaveLength(4);
      
      // Find the adjustment transaction for the final discount update by the expected amount
      const discountAdjustment = transactions.find(t =>
        t.type === 'invoice_adjustment' && t.amount === 1678);
      expect(discountAdjustment).toBeDefined();
      expect(discountAdjustment?.type).toBe('invoice_adjustment');
      expect(discountAdjustment?.amount).toBe(1678);
    });    
  });
});
