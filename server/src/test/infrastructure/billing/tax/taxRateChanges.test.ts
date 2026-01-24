import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { TaxService } from '../../../../lib/services/taxService';
import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import { TextEncoder as NodeTextEncoder } from 'util';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';

// Override DB_PORT to connect directly to PostgreSQL instead of pgbouncer
// This is critical for tests that use advisory locks or other features not supported by pgbouncer
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

describe('Tax Rate Changes Mid-Billing Period', () => {
  let context: TestContext;
  let taxService: TaxService;
  let client_id: string;

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

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates'
      ],
      clientName: 'Test Client',
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

    // Use the default client from context
    client_id = context.clientId;

    // Configure default tax settings for the client (this creates the tax region)
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      clientId: client_id
    });

    // Update the client to have the correct region_code and billing settings
    await context.db('clients')
      .where({ client_id: client_id, tenant: context.tenantId })
      .update({
        is_tax_exempt: false,
        region_code: 'US-NY',
        billing_cycle: 'weekly'
      });

    // Create initial tax rate (10%) for US-NY ending just before new rate starts
    await context.createEntity('tax_rates', {
      tax_type: 'VAT',
      country_code: 'US',
      tax_percentage: 10,
      region_code: 'US-NY',
      is_reverse_charge_applicable: false,
      is_composite: false,
      start_date: '2024-10-01',
      end_date: '2024-10-14',
      is_active: true,
      description: 'Initial Tax Rate'
    }, 'tax_rate_id');

    // Create new tax rate (12%) for US-NY effective 2024-10-15
    await context.createEntity('tax_rates', {
      tax_type: 'VAT',
      country_code: 'US',
      tax_percentage: 12,
      region_code: 'US-NY',
      is_reverse_charge_applicable: false,
      is_composite: false,
      start_date: '2024-10-15',
      is_active: true,
      description: 'Increased Tax Rate'
    }, 'tax_rate_id');
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should apply correct tax rates based on charge dates', async () => {
    // Charge before rate change
    const charge1 = {
      amount: 10000, // $100.00
      date: '2024-10-10'
    };

    // Charge after rate change
    const charge2 = {
      amount: 20000, // $200.00
      date: '2024-10-20'
    };

    // Calculate taxes with explicit tax region
    const taxResult1 = await taxService.calculateTax(
      client_id, 
      charge1.amount, 
      charge1.date,
      'US-NY' // Explicitly pass tax region
    );
    const taxResult2 = await taxService.calculateTax(
      client_id, 
      charge2.amount, 
      charge2.date,
      'US-NY' // Explicitly pass tax region
    );

    // Verify individual taxes
    expect(taxResult1.taxAmount).toBe(1000); // 10% of $100
    expect(taxResult2.taxAmount).toBe(2400); // 12% of $200

    // Verify total tax
    const totalTax = taxResult1.taxAmount + taxResult2.taxAmount;
    expect(totalTax).toBe(3400); // $34.00 total tax
  });
});