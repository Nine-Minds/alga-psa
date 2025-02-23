import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { generateManualInvoice } from '@/lib/actions/manualInvoiceActions';
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
            service_id: serviceId,
            quantity: 1,
            description: 'Discount',
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
      expect(result.tax).toBe(134); // 8.875% of 1500 = 133.20, rounded up
      expect(result.total_amount).toBe(1634); // 1500 + 134
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
});
