import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { createCompanyBillingCycles } from 'server/src/lib/billing/createBillingCycles';
import { TestContext } from '../../../../../test-utils/testContext';
import { Temporal } from '@js-temporal/polyfill';
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

describe('Company Billing Cycle Creation', () => {
  let context: TestContext;

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

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'company_billing_cycles',
        'tax_rates',
        'tax_regions',
        'company_tax_settings',
        'company_tax_rates'
      ],
      companyName: 'Billing Cycle Test Company',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

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

  it('creates a monthly billing cycle if none exists', async () => {
    // Verify no cycles exist initially
    const initialCycles = await context.db('company_billing_cycles')
      .where({
        company_id: context.companyId,
        tenant: context.tenantId
      })
      .orderBy('effective_date', 'asc');
    expect(initialCycles).toHaveLength(0);

    // Create billing cycles
    await createCompanyBillingCycles(context.db, context.company);

    // Verify cycles were created
    const cycles = await context.db('company_billing_cycles')
      .where({
        company_id: context.companyId,
        tenant: context.tenantId
      })
      .orderBy('effective_date', 'asc');

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({
      company_id: context.companyId,
      billing_cycle: 'monthly',
      tenant: context.tenantId
    });

    // Verify period dates
    const cycle = cycles[0];
    expect(cycle.period_start_date).toBeDefined();
    expect(cycle.period_end_date).toBeDefined();

    // Convert ISO strings to Temporal instances for comparison
    const startDate = Temporal.Instant.from(new Date(cycle.period_start_date).toISOString())
        .toZonedDateTimeISO('UTC');
    const endDate = Temporal.Instant.from(new Date(cycle.period_end_date).toISOString())
        .toZonedDateTimeISO('UTC');

    // Verify period length is one month using Temporal API
    const monthDiff = (endDate.year - startDate.year) * 12 +
                    (endDate.month - startDate.month);
    expect(monthDiff).toBe(1);

    // Verify dates are properly formatted ISO strings
    expect(new Date(cycle.period_start_date).toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(new Date(cycle.period_end_date).toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  });
});
