import { describe, it, expect } from 'vitest';
import { createClientContractLineCycles } from 'server/src/lib/billing/createBillingCycles';
import { TestContext } from 'server/test-utils/testContext';
import { dateHelpers } from 'server/test-utils/dateUtils';
import { Temporal } from '@js-temporal/polyfill';
import { TextEncoder as NodeTextEncoder } from 'util';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';

// Required for tests
global.TextEncoder = TextEncoder as any;

describe('Client Billing Cycle Creation', () => {
  let context: TestContext;

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
        'client_billing_cycles',
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
    const { db, client, clientId, tenantId } = context;

    // Verify no cycles exist initially
    const initialCycles = await db('client_billing_cycles')
      .where({
        client_id: clientId,
        tenant: tenantId
      })
      .orderBy('effective_date', 'asc');
    expect(initialCycles).toHaveLength(0);

    // Create billing cycles
    await createClientContractLineCycles(db, client);

    // Verify cycles were created
    const cycles = await db('client_billing_cycles')
      .where({
        client_id: clientId,
        tenant: tenantId
      })
      .orderBy('effective_date', 'asc');

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({
      client_id: clientId,
      billing_cycle: 'monthly',
      tenant: tenantId
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
