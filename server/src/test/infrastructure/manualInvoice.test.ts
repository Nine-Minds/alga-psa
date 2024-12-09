import { describe, it, expect, vi, beforeEach, beforeAll, afterEach, afterAll } from 'vitest';
import { generateManualInvoice } from '@/lib/actions/manualInvoiceActions';
import { v4 as uuidv4 } from 'uuid';
import knex from 'knex';
import { TextEncoder } from 'util';
import dotenv from 'dotenv';

dotenv.config();
global.TextEncoder = TextEncoder;

// Mock Headers implementation
const mockHeaders = {
  get: vi.fn((key: string) => key === 'x-tenant-id' ? '11111111-1111-1111-1111-111111111111' : null),
  append: vi.fn(), delete: vi.fn(), entries: vi.fn(), forEach: vi.fn(),
  has: vi.fn(), keys: vi.fn(), set: vi.fn(), values: vi.fn(),
};

vi.mock('next/headers', () => ({
  headers: vi.fn(() => mockHeaders)
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(() => Promise.resolve({
    user: { id: 'mock-user-id', tenant: '11111111-1111-1111-1111-111111111111' },
  })),
}));

vi.mock("@/app/api/auth/[...nextauth]/options", () => ({
  options: {},
}));

// Test Data Factory Functions
const createTestService = async (db: knex.Knex, overrides = {}) => {
  const serviceId = uuidv4();
  const defaultService = {
    service_id: serviceId,
    tenant: '11111111-1111-1111-1111-111111111111',
    service_name: 'Test Service',
    service_type: 'Fixed',
    default_rate: 1000,
    unit_of_measure: 'each',
    is_taxable: true,
    tax_region: 'US-NY'
  };

  await db('service_catalog').insert({ ...defaultService, ...overrides });
  return serviceId;
};

const setupTaxConfiguration = async (db: knex.Knex, companyId: string) => {
  const taxRateId = uuidv4();
  await db('tax_rates').insert({
    tax_rate_id: taxRateId,
    tenant: '11111111-1111-1111-1111-111111111111',
    region: 'US-NY',
    tax_percentage: 8.875,
    description: 'NY State + City Tax',
    start_date: new Date().toISOString()
  });

  await db('company_tax_settings').insert({
    company_id: companyId,
    tenant: '11111111-1111-1111-1111-111111111111',
    tax_rate_id: taxRateId,
    is_reverse_charge_applicable: false
  });

  return taxRateId;
};

let db: knex.Knex;
let companyId: string;

beforeAll(async () => {
  db = knex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER_ADMIN,
      password: process.env.DB_PASSWORD_SERVER,
      database: process.env.DB_NAME_SERVER
    },
    migrations: { directory: "./migrations" },
    seeds: { directory: "./seeds/dev" }
  });
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  // Reset database
  await db.raw('DROP SCHEMA public CASCADE');
  await db.raw('CREATE SCHEMA public');
  await db.raw(`SET app.environment = '${process.env.APP_ENV}'`);
  await db.migrate.latest();
  await db.seed.run();

  // Get test company
  const company = await db('companies')
    .where({ tenant: '11111111-1111-1111-1111-111111111111' })
    .first();
  
  if (!company) throw new Error('No seeded company found for testing');
  companyId = company.company_id;
});

describe('Manual Invoice Generation', () => {
  describe('Basic Invoice Creation', () => {
    it('creates a manual invoice with single line item', async () => {
      const serviceId = await createTestService(db);
      await setupTaxConfiguration(db, companyId);

      const result = await generateManualInvoice({
        companyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Test Service Item',
          rate: 1000
        }]
      });

      expect(result).toMatchObject({
        company_id: companyId,
        invoice_number: expect.stringMatching(/^INV-\d{6}$/),
        status: 'draft'
      });

      expect(result.subtotal).toBe(1000);
      expect(result.tax).toBe(89); // 8.875% of 1000 = 88.75, rounded up
      expect(result.total_amount).toBe(1089);
    });

    it('creates a manual invoice with multiple line items', async () => {
      const service1Id = await createTestService(db);
      const service2Id = await createTestService(db, { service_name: 'Second Service' });
      await setupTaxConfiguration(db, companyId);

      const result = await generateManualInvoice({
        companyId,
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
      expect(result.tax).toBe(223); // (2000 * 8.88%) + (500 * 8.88%)
      expect(result.total_amount).toBe(2723);
    });
  });

  describe('Validation and Error Handling', () => {
    it('rejects invalid company IDs', async () => {
      const serviceId = await createTestService(db);
      const invalidCompanyId = '12345678-1234-1234-1234-123456789012';
      
      await expect(generateManualInvoice({
        companyId: invalidCompanyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Test Service',
          rate: 1000
        }]
      })).rejects.toThrow('Company not found');
    });

    it('rejects invalid service IDs', async () => {
      const invalidServiceId = uuidv4();
      
      await expect(generateManualInvoice({
        companyId,
        items: [{
          service_id: invalidServiceId,
          quantity: 1,
          description: 'Test Service',
          rate: 1000
        }]
      })).rejects.toThrow();
    });
  });

  describe('Tax Calculations', () => {
    it('applies correct tax rates based on region', async () => {
      const serviceId = await createTestService(db);
      const taxRateId = await setupTaxConfiguration(db, companyId);

      // Update tax rate to a different percentage
      await db('tax_rates')
        .where({ tax_rate_id: taxRateId })
        .update({ tax_percentage: 10 });

      const result = await generateManualInvoice({
        companyId,
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
      const serviceId = await createTestService(db);
      await setupTaxConfiguration(db, companyId);

      // Make company tax exempt
      await db('companies')
        .where({ company_id: companyId })
        .update({ is_tax_exempt: true });

      const result = await generateManualInvoice({
        companyId,
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
  });

  describe('Transaction Recording', () => {
    it('creates appropriate transaction records', async () => {
      const serviceId = await createTestService(db);
      await setupTaxConfiguration(db, companyId);

      const result = await generateManualInvoice({
        companyId,
        items: [{
          service_id: serviceId,
          quantity: 1,
          description: 'Test Service',
          rate: 1000
        }]
      });

      const transactions = await db('transactions')
        .where({ 
          invoice_id: result.invoice_id,
          tenant: '11111111-1111-1111-1111-111111111111'
        });

      expect(transactions).toHaveLength(1);
      expect(transactions[0]).toMatchObject({
        company_id: companyId,
        type: 'invoice_generated',
        status: 'completed',
        amount: 1089 // Including tax
      });
    });
  });
});
