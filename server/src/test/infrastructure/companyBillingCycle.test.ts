import { describe, it, expect } from 'vitest';
import { createCompanyBillingCycles } from '../../lib/billing/createBillingCycles';
import { TestContext } from '../../../test-utils/testContext';
import { dateHelpers } from '../../../test-utils/dateUtils';
import { Temporal } from '@js-temporal/polyfill';
import { TextEncoder } from 'util';

// Required for tests
global.TextEncoder = TextEncoder;

describe('Company Billing Cycle Creation', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;

  // Initialize test context before all tests
  testHelpers.beforeAll({
    runSeeds: true,
    cleanupTables: ['company_billing_cycles'],
    companyName: 'Test Company',
    userType: 'admin'
  }).then(ctx => {
    context = ctx;
  });

  // Reset test context before each test
  testHelpers.beforeEach();

  // Clean up test context after all tests
  testHelpers.afterAll();

  it('creates a monthly billing cycle if none exists', async () => {
    const { db, company } = context;

    // Verify no cycles exist initially
    const initialCycles = await db('company_billing_cycles')
      .where({ 
        company_id: company.company_id,
        tenant: company.tenant 
      })
      .orderBy('effective_date', 'asc');
    expect(initialCycles).toHaveLength(0);

    // Create billing cycles
    await createCompanyBillingCycles(db, company);

    // Verify cycles were created
    const cycles = await db('company_billing_cycles')
      .where({ 
        company_id: company.company_id,
        tenant: company.tenant 
      })
      .orderBy('effective_date', 'asc');

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({
      company_id: company.company_id,
      billing_cycle: 'monthly',
      tenant: company.tenant
    });

    // Verify period dates
    const cycle = cycles[0];
    expect(cycle.period_start_date).toBeDefined();
    expect(cycle.period_end_date).toBeDefined();
    
    // Convert ISO strings to Temporal.ZonedDateTime for comparison
    const startDate = Temporal.ZonedDateTime.from(cycle.period_start_date);
    const endDate = Temporal.ZonedDateTime.from(cycle.period_end_date);

    // Verify period length is one month using Temporal API
    const monthDiff = (endDate.year - startDate.year) * 12 + 
                     (endDate.month - startDate.month);
    expect(monthDiff).toBe(1);

    // Verify dates are properly formatted ISO strings
    expect(cycle.period_start_date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(cycle.period_end_date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  });
});
