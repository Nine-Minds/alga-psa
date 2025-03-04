import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import '../../../test-utils/nextApiMock';
import { getDueDate } from 'server/src/lib/actions/invoiceActions';
import { TestContext } from '../../../test-utils/testContext';
import { Temporal } from '@js-temporal/polyfill';
import { setupCommonMocks } from 'server/test-utils/testMocks';

describe('Invoice Due Date Calculation', () => {
  const testHelpers = TestContext.createHelpers();
  let context: TestContext;
  const billingEndDate = '2025-01-31T00:00:00Z';

  beforeAll(async () => {
    context = await testHelpers.beforeAll({
      runSeeds: true,
      cleanupTables: [
        'companies',
        'invoices'
      ]
    });
    setupCommonMocks({ tenantId: context.tenantId });
  });

  beforeEach(async () => {
    await testHelpers.beforeEach();
  });

  afterAll(async () => {
    await testHelpers.afterAll();
  });

  it('should calculate due date for net_30 terms', async () => {
    // Create test company with net_30 terms
    const companyId = await context.createEntity('companies', {
      company_name: 'Test Company 2',
      payment_terms: 'net_30'
    }, 'company_id');

    const dueDate = await getDueDate(companyId, billingEndDate);
    const expectedDate = Temporal.PlainDate.from('2025-03-02');
    expect(Temporal.PlainDate.compare(
      Temporal.PlainDate.from(dueDate),
      expectedDate
    )).toBe(0);
  });

  it('should calculate due date for net_15 terms', async () => {
    // Create test company with net_15 terms
    const companyId = await context.createEntity('companies', {
      company_name: 'Test Company 2',
      payment_terms: 'net_15'
    }, 'company_id');

    const dueDate = await getDueDate(companyId, billingEndDate);
    const expectedDate = Temporal.PlainDate.from('2025-02-15');
    expect(Temporal.PlainDate.compare(
      Temporal.PlainDate.from(dueDate),
      expectedDate
    )).toBe(0);
  });

  it('should calculate due date for due_on_receipt terms', async () => {
    // Create test company with due_on_receipt terms
    const companyId = await context.createEntity('companies', {
      company_name: 'Test Company 2',
      payment_terms: 'due_on_receipt'
    }, 'company_id');

    const dueDate = await getDueDate(companyId, billingEndDate);
    const expectedDate = Temporal.PlainDate.from('2025-01-31');
    expect(Temporal.PlainDate.compare(
      Temporal.PlainDate.from(dueDate),
      expectedDate
    )).toBe(0);
  });

  it('should default to net_30 for unknown payment terms', async () => {
    // Create test company with unknown terms
    const companyId = await context.createEntity('companies', {
      company_name: 'Test Company 2',
      payment_terms: 'unknown'
    }, 'company_id');

    const dueDate = await getDueDate(companyId, billingEndDate);
    const expectedDate = Temporal.PlainDate.from('2025-03-02');
    expect(Temporal.PlainDate.compare(
      Temporal.PlainDate.from(dueDate),
      expectedDate
    )).toBe(0);
  });
});