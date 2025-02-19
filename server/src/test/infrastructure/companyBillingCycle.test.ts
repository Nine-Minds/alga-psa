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

  // Fix: Use beforeAll properly with async/await
  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      cleanupTables: ['company_billing_cycles'],
      companyName: 'Test Company',
      userType: 'internal'
    });
  });

  // Reset test context before each test
  beforeEach(async () => {
    await testHelpers.beforeEach();
  });

  // Clean up test context after all tests
  afterAll(async () => {
    await testHelpers.afterAll();
  });

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
    
    console.log('period start date', cycle.period_start_date);

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
