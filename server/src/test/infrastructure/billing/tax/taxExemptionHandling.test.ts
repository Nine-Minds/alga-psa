import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { TaxService } from 'server/src/lib/services/taxService';
import { Temporal } from '@js-temporal/polyfill';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import {
  setupClientTaxConfiguration,
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

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
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
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  async function createClientRecord(overrides: Partial<IClient> = {}): Promise<string> {
    const client_id = overrides.client_id ?? uuidv4();
    const now = new Date().toISOString();

    await context.db('clients').insert({
      client_id,
      tenant: context.tenantId,
      client_name: overrides.client_name ?? 'Test Client',
      is_tax_exempt: overrides.is_tax_exempt ?? false,
      region_code: overrides.region_code ?? 'US-NY',
      credit_balance: overrides.credit_balance ?? 0,
      billing_cycle: overrides.billing_cycle ?? 'monthly',
      is_inactive: overrides.is_inactive ?? false,
      created_at: overrides.created_at ?? now,
      updated_at: overrides.updated_at ?? now
    });

    return client_id;
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'clients',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates'
      ],
      clientName: 'Tax Exemption Test Client',
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

  it('should not apply tax to exempt clients', async () => {
    // Create a tax-exempt client
    const client_id = await createClientRecord({
      client_name: 'Exempt Client',
      is_tax_exempt: true,
      billing_cycle: 'weekly'
    });

    // Configure tax for exempt client
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      clientId: client_id
    });

    // Create a test charge
    const chargeAmount = 10000; // $100.00 in cents
    const currentDate = Temporal.Now.plainDateISO().toString();
    const taxResult = await taxService.calculateTax(client_id, chargeAmount, currentDate);

    expect(taxResult.taxAmount).toBe(0);
    expect(taxResult.taxRate).toBe(0);
  });

  it('should apply tax to non-exempt clients', async () => {
    // Create a non-exempt client
    const client_id = await createClientRecord({
      client_name: 'Non-Exempt Client',
      is_tax_exempt: false,
      billing_cycle: 'weekly'
    });

    // Configure tax for non-exempt client
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      clientId: client_id
    });

    // Create a test charge
    const chargeAmount = 10000; // $100.00 in cents
    const currentDate = Temporal.Now.plainDateISO().toString();
    const taxResult = await taxService.calculateTax(client_id, chargeAmount, currentDate);

    expect(taxResult.taxAmount).toBeGreaterThan(0);
    expect(parseInt(taxResult.taxRate.toString())).toBeGreaterThan(0);
  });

  it('should handle tax exemption status changes', async () => {
    // Create a client
    const client_id = await createClientRecord({
      client_name: 'Status Change Client',
      is_tax_exempt: false,
      billing_cycle: 'weekly'
    });

    // Configure tax for client
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      clientId: client_id
    });

    // Test as non-exempt
    const chargeAmount = 10000;
    const currentDate = Temporal.Now.plainDateISO().toString();
    let taxResult = await taxService.calculateTax(client_id, chargeAmount, currentDate);
    expect(taxResult.taxAmount).toBeGreaterThan(0);

    // Update to exempt
    await context.db('clients')
      .where({ client_id: client_id })
      .update({ is_tax_exempt: true });

    // Test as exempt
    taxResult = await taxService.calculateTax(client_id, chargeAmount, currentDate);
    expect(taxResult.taxAmount).toBe(0);
  });
});
