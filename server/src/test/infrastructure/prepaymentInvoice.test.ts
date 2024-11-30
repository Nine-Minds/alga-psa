import { describe, it, expect, vi, beforeEach, beforeAll, afterEach, afterAll } from 'vitest';
import { startOfMonth, endOfMonth, subMonths, addMonths, format } from 'date-fns';
import { finalizeInvoice, generateInvoice } from '@/lib/actions/invoiceActions';
import { createPrepaymentInvoice } from '@/lib/actions/creditActions';
import { v4 as uuidv4 } from 'uuid';
import knex from 'knex';
import { TextEncoder } from 'util';
import dotenv from 'dotenv';
import CompanyBillingPlan from '@/lib/models/clientBilling';

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

const createTestPlan = async (db: knex.Knex, serviceId: string, overrides = {}) => {
  const planId = uuidv4();
  const defaultPlan = {
    plan_id: planId,
    tenant: '11111111-1111-1111-1111-111111111111',
    plan_name: 'Test Plan',
    billing_frequency: 'monthly',
    is_custom: false,
    plan_type: 'Fixed'
  };

  await db('billing_plans').insert({ ...defaultPlan, ...overrides });
  await db('plan_services').insert({
    plan_id: planId,
    service_id: serviceId,
    tenant: '11111111-1111-1111-1111-111111111111',
    quantity: 1
  });

  return planId;
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

describe('Prepayment Invoice System', () => {
  describe('Creating Prepayment Invoices', () => {
    it('creates a prepayment invoice with correct details', async () => {
      const prepaymentAmount = 100000;
      const result = await createPrepaymentInvoice(companyId, prepaymentAmount);

      expect(result).toMatchObject({
        invoice_number: expect.stringMatching(/^INV-\d{6}$/),
        subtotal: prepaymentAmount,
        total_amount: prepaymentAmount,
        status: 'draft'
      });
    });

    it('rejects invalid company IDs', async () => {
      const invalidCompanyId = '12345678-1234-1234-1234-123456789012';
      
      await expect(createPrepaymentInvoice(invalidCompanyId, 100000))
        .rejects
        .toThrow('Company not found');

      const invoices = await db('invoices')
        .where({ 
          company_id: invalidCompanyId,
          tenant: '11111111-1111-1111-1111-111111111111'
        });
      expect(invoices).toHaveLength(0);

      const transactions = await db('transactions')
        .where({ 
          company_id: invalidCompanyId,
          tenant: '11111111-1111-1111-1111-111111111111'
        });
      expect(transactions).toHaveLength(0);
    });
  });

  describe('Finalizing Prepayment Invoices', () => {
    it('finalizes a prepayment invoice and creates credit', async () => {
      const prepaymentAmount = 100000;
      const invoice = await createPrepaymentInvoice(companyId, prepaymentAmount);
      const finalizedInvoice = await finalizeInvoice(invoice.invoice_id);

      expect(finalizedInvoice).toMatchObject({
        invoice_id: invoice.invoice_id,
        status: 'sent'
      });

      const creditTransaction = await db('transactions')
        .where({
          invoice_id: invoice.invoice_id,
          tenant: '11111111-1111-1111-1111-111111111111',
          type: 'credit_issuance'
        })
        .first();

      expect(creditTransaction).toMatchObject({
        company_id: companyId,
        status: 'completed',
        description: 'Credit issued from prepayment'
      });
      expect(parseFloat(creditTransaction.amount)).toBe(prepaymentAmount);

      const creditBalance = await CompanyBillingPlan.getCompanyCredit(companyId);
      expect(parseInt(creditBalance+'')).toBe(prepaymentAmount);
    });
  });

  describe('Credit Application in Billing', () => {
    let serviceId: string;
    let planId: string;

    beforeEach(async () => {
      // Setup billing configuration
      serviceId = await createTestService(db);
      planId = await createTestPlan(db, serviceId);
      await setupTaxConfiguration(db, companyId);

      const now = new Date();
      const startDate = format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'");
      
      await db('company_billing_plans').insert({
        company_billing_plan_id: uuidv4(),
        company_id: companyId,
        plan_id: planId,
        tenant: '11111111-1111-1111-1111-111111111111',
        start_date: startDate,
        is_active: true
      });
    });

    it('automatically applies available credit when generating an invoice', async () => {
      // Setup prepayment
      const prepaymentAmount = 100000;
      const prepaymentInvoice = await createPrepaymentInvoice(companyId, prepaymentAmount);
      await finalizeInvoice(prepaymentInvoice.invoice_id);

      const initialCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
      expect(parseInt(initialCredit+'')).toBe(prepaymentAmount);

      // Generate billing invoice
      const now = new Date();
      const startDate = format(startOfMonth(now), "yyyy-MM-dd'T'00:00:00.000'Z'");
      const endDate = format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'");
      
      const invoice = await generateInvoice(companyId, startDate, endDate);

      // Verify credit application
      expect(invoice.total).toBeLessThan(invoice.subtotal + invoice.tax);
      const creditApplied = invoice.subtotal + invoice.tax - invoice.total;
      expect(creditApplied).toBeGreaterThan(0);

      // Verify credit balance update
      const finalCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
      expect(parseInt(finalCredit+'')).toBe(prepaymentAmount - creditApplied);

      // Verify credit transaction
      const creditTransaction = await db('transactions')
        .where({
          company_id: companyId,
          invoice_id: invoice.invoice_id,
          type: 'credit_application'
        })
        .first();

      expect(creditTransaction).toBeTruthy();
      expect(parseFloat(creditTransaction.amount)).toBe(-creditApplied);
    });
  });
});

describe('Multiple Credit Applications', () => {
  let serviceId: string;
  let planId: string;

  beforeEach(async () => {
    // Setup billing configuration
    serviceId = uuidv4();
    planId = uuidv4();

    await db('billing_plans').insert({
      plan_id: planId,
      tenant: '11111111-1111-1111-1111-111111111111',
      plan_name: 'Test Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    });

    await db('service_catalog').insert({
      service_id: serviceId,
      tenant: '11111111-1111-1111-1111-111111111111',
      service_name: 'Test Service',
      service_type: 'Fixed',
      default_rate: 1000,
      unit_of_measure: 'each',
      is_taxable: true,
      tax_region: 'US-NY'
    });

    // Add tax rate and company tax settings
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

    await db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      tenant: '11111111-1111-1111-1111-111111111111',
      quantity: 1
    });

    const now = new Date();
    const startDate = format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'");
    
    await db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: companyId,
      plan_id: planId,
      tenant: '11111111-1111-1111-1111-111111111111',
      start_date: startDate,
      is_active: true
    });
  });

  it('applies credit from multiple prepayment invoices to a single invoice', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(companyId, prepaymentAmount1);
    await finalizeInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(companyId, prepaymentAmount2);
    await finalizeInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate a billing invoice that is less than total prepayment
    const now = new Date();
    const startDate = format(startOfMonth(now), "yyyy-MM-dd'T'00:00:00.000'Z'");
    const endDate = format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'");
    
    const invoice = await generateInvoice(companyId, startDate, endDate);

    // Verify credit application
    expect(invoice.total).toBeLessThan(invoice.subtotal + invoice.tax);
    const creditApplied = invoice.subtotal + invoice.tax - invoice.total;
    expect(creditApplied).toBeGreaterThan(0);

    // Verify credit balance update
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - creditApplied);

    // Verify credit transaction
    const creditTransaction = await db('transactions')
      .where({
        company_id: companyId,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-creditApplied);
  });

  it('distributes credit across multiple invoices', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(companyId, prepaymentAmount1);
    await finalizeInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(companyId, prepaymentAmount2);
    await finalizeInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate multiple billing invoices
    const now = new Date();
    const invoice1 = await generateInvoice(companyId, format(startOfMonth(now), "yyyy-MM-dd'T'00:00:00.000'Z'"), format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'"));
    const invoice2 = await generateInvoice(companyId, format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'"), format(startOfMonth(addMonths(now, 2)), "yyyy-MM-dd'T'00:00:00.000'Z'"));

    // Verify credit application on invoice1
    expect(invoice1.total).toBeLessThan(invoice1.subtotal + invoice1.tax);
    const creditApplied1 = invoice1.subtotal + invoice1.tax - invoice1.total;
    expect(creditApplied1).toBeGreaterThan(0);

    // Verify credit application on invoice2
    expect(invoice2.total).toBeLessThan(invoice2.subtotal + invoice2.tax);
    const creditApplied2 = invoice2.subtotal + invoice2.tax - invoice2.total;
    expect(creditApplied2).toBeGreaterThan(0);

    // Verify total credit applied
    const totalCreditApplied = creditApplied1 + creditApplied2;
    expect(totalCreditApplied).toBeLessThanOrEqual(totalPrepayment);

    // Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - totalCreditApplied);
  });

  it('handles cases where credit exceeds billing amounts', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(companyId, prepaymentAmount1);
    await finalizeInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(companyId, prepaymentAmount2);
    await finalizeInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate a billing invoice with a smaller amount
    const now = new Date();
    const startDate = format(startOfMonth(now), "yyyy-MM-dd'T'00:00:00.000'Z'");
    const endDate = format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'");
    
    const invoice = await generateInvoice(companyId, startDate, endDate);

    // Verify credit application
    expect(invoice.total).toBe(0);
    const creditApplied = invoice.subtotal + invoice.tax;
    expect(creditApplied).toBeLessThanOrEqual(totalPrepayment);

    // Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - creditApplied);
  });

  it('handles cases where credit is insufficient for billing amounts', async () => {
    // Setup a prepayment
    const prepaymentAmount = 1000;
    const prepaymentInvoice = await createPrepaymentInvoice(companyId, prepaymentAmount);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const initialCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(initialCredit+'')).toBe(prepaymentAmount);

    // Generate a billing invoice with a larger amount
    const now = new Date();
    const startDate = format(startOfMonth(now), "yyyy-MM-dd'T'00:00:00.000'Z'");
    const endDate = format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'");
    
    const invoice = await generateInvoice(companyId, startDate, endDate);

    // Verify credit application
    expect(invoice.total).toBeLessThan(invoice.subtotal + invoice.tax);
    const creditApplied = prepaymentAmount;
    expect(invoice.total).toBe(invoice.subtotal + invoice.tax - creditApplied);

    // Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(finalCredit+'')).toBe(0);
  });
});

describe('Multiple Credit Applications', () => {
  let serviceId: string;
  let planId: string;

  beforeEach(async () => {
    // Setup billing configuration
    serviceId = uuidv4();
    planId = uuidv4();

    await db('billing_plans').insert({
      plan_id: planId,
      tenant: '11111111-1111-1111-1111-111111111111',
      plan_name: 'Test Plan',
      billing_frequency: 'monthly',
      is_custom: false,
      plan_type: 'Fixed'
    });

    await db('service_catalog').insert({
      service_id: serviceId,
      tenant: '11111111-1111-1111-1111-111111111111',
      service_name: 'Test Service',
      service_type: 'Fixed',
      default_rate: 1000,
      unit_of_measure: 'each',
      is_taxable: true,
      tax_region: 'US-NY'
    });

    // Add tax rate and company tax settings
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

    await db('plan_services').insert({
      plan_id: planId,
      service_id: serviceId,
      tenant: '11111111-1111-1111-1111-111111111111',
      quantity: 1
    });

    const now = new Date();
    const startDate = format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'");
    
    await db('company_billing_plans').insert({
      company_billing_plan_id: uuidv4(),
      company_id: companyId,
      plan_id: planId,
      tenant: '11111111-1111-1111-1111-111111111111',
      start_date: startDate,
      is_active: true
    });
  });

  it('applies credit from multiple prepayment invoices to a single invoice', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(companyId, prepaymentAmount1);
    await finalizeInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(companyId, prepaymentAmount2);
    await finalizeInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate a billing invoice that is less than total prepayment
    const now = new Date();
    const startDate = format(startOfMonth(now), "yyyy-MM-dd'T'00:00:00.000'Z'");
    const endDate = format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'");
    
    const invoice = await generateInvoice(companyId, startDate, endDate);

    // Verify credit application
    expect(invoice.total).toBeLessThan(invoice.subtotal + invoice.tax);
    const creditApplied = invoice.subtotal + invoice.tax - invoice.total;
    expect(creditApplied).toBeGreaterThan(0);

    // Verify credit balance update
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - creditApplied);

    // Verify credit transaction
    const creditTransaction = await db('transactions')
      .where({
        company_id: companyId,
        invoice_id: invoice.invoice_id,
        type: 'credit_application'
      })
      .first();

    expect(creditTransaction).toBeTruthy();
    expect(parseFloat(creditTransaction.amount)).toBe(-creditApplied);
  });

  it('distributes credit across multiple invoices', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(companyId, prepaymentAmount1);
    await finalizeInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(companyId, prepaymentAmount2);
    await finalizeInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate multiple billing invoices
    const now = new Date();
    const invoice1 = await generateInvoice(companyId, format(startOfMonth(now), "yyyy-MM-dd'T'00:00:00.000'Z'"), format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'"));
    const invoice2 = await generateInvoice(companyId, format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'"), format(startOfMonth(addMonths(now, 2)), "yyyy-MM-dd'T'00:00:00.000'Z'"));

    // Verify credit application on invoice1
    expect(invoice1.total).toBeLessThan(invoice1.subtotal + invoice1.tax);
    const creditApplied1 = invoice1.subtotal + invoice1.tax - invoice1.total;
    expect(creditApplied1).toBeGreaterThan(0);

    // Verify credit application on invoice2
    expect(invoice2.total).toBeLessThan(invoice2.subtotal + invoice2.tax);
    const creditApplied2 = invoice2.subtotal + invoice2.tax - invoice2.total;
    expect(creditApplied2).toBeGreaterThan(0);

    // Verify total credit applied
    const totalCreditApplied = creditApplied1 + creditApplied2;
    expect(totalCreditApplied).toBeLessThanOrEqual(totalPrepayment);

    // Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - totalCreditApplied);
  });

  it('handles cases where credit exceeds billing amounts', async () => {
    // Setup multiple prepayments
    const prepaymentAmount1 = 50000;
    const prepaymentInvoice1 = await createPrepaymentInvoice(companyId, prepaymentAmount1);
    await finalizeInvoice(prepaymentInvoice1.invoice_id);

    const prepaymentAmount2 = 30000;
    const prepaymentInvoice2 = await createPrepaymentInvoice(companyId, prepaymentAmount2);
    await finalizeInvoice(prepaymentInvoice2.invoice_id);

    const totalPrepayment = prepaymentAmount1 + prepaymentAmount2;
    const initialCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(initialCredit+'')).toBe(totalPrepayment);

    // Generate a billing invoice with a smaller amount
    const now = new Date();
    const startDate = format(startOfMonth(now), "yyyy-MM-dd'T'00:00:00.000'Z'");
    const endDate = format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'");
    
    const invoice = await generateInvoice(companyId, startDate, endDate);

    // Verify credit application
    expect(invoice.total).toBe(0);
    const creditApplied = invoice.subtotal + invoice.tax;
    expect(creditApplied).toBeLessThanOrEqual(totalPrepayment);

    // Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(finalCredit+'')).toBe(totalPrepayment - creditApplied);
  });

  it('handles cases where credit is insufficient for billing amounts', async () => {
    // Setup a prepayment
    const prepaymentAmount = 1000;
    const prepaymentInvoice = await createPrepaymentInvoice(companyId, prepaymentAmount);
    await finalizeInvoice(prepaymentInvoice.invoice_id);

    const initialCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(initialCredit+'')).toBe(prepaymentAmount);

    // Generate a billing invoice with a larger amount
    const now = new Date();
    const startDate = format(startOfMonth(now), "yyyy-MM-dd'T'00:00:00.000'Z'");
    const endDate = format(startOfMonth(addMonths(now, 1)), "yyyy-MM-dd'T'00:00:00.000'Z'");
    
    const invoice = await generateInvoice(companyId, startDate, endDate);

    // Verify credit application
    expect(invoice.total).toBeLessThan(invoice.subtotal + invoice.tax);
    const creditApplied = prepaymentAmount;
    expect(invoice.total).toBe(invoice.subtotal + invoice.tax - creditApplied);

    // Verify final credit balance
    const finalCredit = await CompanyBillingPlan.getCompanyCredit(companyId);
    expect(parseInt(finalCredit+'')).toBe(0);
  });
});
