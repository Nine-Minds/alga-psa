import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { TaxService } from 'server/src/lib/services/taxService';
import { Temporal } from '@js-temporal/polyfill';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import {
  setupCompanyTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';

// Override DB_PORT to connect directly to PostgreSQL instead of pgbouncer
process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

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

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

describe('Tax Exemption Handling', () => {
  let context: TestContext;
  let taxService: TaxService;

  async function configureDefaultTax() {
    await setupCompanyTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  async function createCompanyRecord(overrides: Partial<ICompany> = {}): Promise<string> {
    const company_id = overrides.company_id ?? uuidv4();
    const now = new Date().toISOString();

    await context.db('companies').insert({
      company_id,
      tenant: context.tenantId,
      company_name: overrides.company_name ?? 'Test Company',
      is_tax_exempt: overrides.is_tax_exempt ?? false,
      region_code: overrides.region_code ?? 'US-NY',
      credit_balance: overrides.credit_balance ?? 0,
      billing_cycle: overrides.billing_cycle ?? 'monthly',
      is_inactive: overrides.is_inactive ?? false,
      created_at: overrides.created_at ?? now,
      updated_at: overrides.updated_at ?? now
    });

    return company_id;
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'companies',
        'tax_rates',
        'tax_regions',
        'company_tax_settings',
        'company_tax_rates'
      ],
      companyName: 'Tax Exemption Test Company',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    taxService = new TaxService();
    await configureDefaultTax();
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await configureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should not apply tax to exempt companies', async () => {
    // Create a tax-exempt company
    const company_id = await createCompanyRecord({
      company_name: 'Exempt Company',
      is_tax_exempt: true,
      billing_cycle: 'weekly'
    });

    // Configure tax for exempt company
    await setupCompanyTaxConfiguration(context, {
      regionCode: 'US-NY',
      companyId: company_id
    });

    // Create a test charge
    const chargeAmount = 10000; // $100.00 in cents
    const currentDate = Temporal.Now.plainDateISO().toString();
    const taxResult = await taxService.calculateTax(company_id, chargeAmount, currentDate);

    expect(taxResult.taxAmount).toBe(0);
    expect(taxResult.taxRate).toBe(0);
  });

  it('should apply tax to non-exempt companies', async () => {
    // Create a non-exempt company
    const company_id = await createCompanyRecord({
      company_name: 'Non-Exempt Company',
      is_tax_exempt: false,
      billing_cycle: 'weekly'
    });

    // Configure tax for non-exempt company
    await setupCompanyTaxConfiguration(context, {
      regionCode: 'US-NY',
      companyId: company_id
    });

    // Create a test charge
    const chargeAmount = 10000; // $100.00 in cents
    const currentDate = Temporal.Now.plainDateISO().toString();
    const taxResult = await taxService.calculateTax(company_id, chargeAmount, currentDate);

    expect(taxResult.taxAmount).toBeGreaterThan(0);
    expect(parseInt(taxResult.taxRate.toString())).toBeGreaterThan(0);
  });

  it('should handle tax exemption status changes', async () => {
    // Create a company
    const company_id = await createCompanyRecord({
      company_name: 'Status Change Company',
      is_tax_exempt: false,
      billing_cycle: 'weekly'
    });

    // Configure tax for company
    await setupCompanyTaxConfiguration(context, {
      regionCode: 'US-NY',
      companyId: company_id
    });

    // Test as non-exempt
    const chargeAmount = 10000;
    const currentDate = Temporal.Now.plainDateISO().toString();
    let taxResult = await taxService.calculateTax(company_id, chargeAmount, currentDate);
    expect(taxResult.taxAmount).toBeGreaterThan(0);

    // Update to exempt
    await context.db('companies')
      .where({ company_id: company_id })
      .update({ is_tax_exempt: true });

    // Test as exempt
    taxResult = await taxService.calculateTax(company_id, chargeAmount, currentDate);
    expect(taxResult.taxAmount).toBe(0);
  });
});
