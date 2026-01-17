import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { getDueDate } from '@alga-psa/billing/actions/billingAndTax';
import { TestContext } from '../../../../../test-utils/testContext';
import { Temporal } from '@js-temporal/polyfill';
import { TextEncoder as NodeTextEncoder } from 'util';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  ensureDefaultBillingSettings
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

vi.mock('@alga-psa/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/core', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {}
  })
}));

vi.mock('@alga-psa/shared/workflow/persistence', () => ({
  WorkflowEventModel: {
    create: vi.fn()
  }
}));

vi.mock('@alga-psa/shared/workflow/streams', () => ({
  getRedisStreamClient: () => ({
    publishEvent: vi.fn()
  }),
  toStreamEvent: (event: unknown) => event
}));

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

describe('Invoice Due Date Calculation', () => {
  let context: TestContext;
  const billingEndDate = '2025-01-31T00:00:00Z';

  async function configureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: false });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: false,
      cleanupTables: [
        'clients',
        'invoices',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates'
      ],
      clientName: 'Due Date Test Client',
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
    await ensureDefaultBillingSettings(context);
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
    await ensureDefaultBillingSettings(context);
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should calculate due date for net_30 terms', async () => {
    // Create test client with net_30 terms
    const clientId = await context.createEntity('clients', {
      client_name: 'Test Client 2',
      payment_terms: 'net_30'
    }, 'client_id');

    const dueDate = await getDueDate(clientId, billingEndDate);
    const expectedDate = Temporal.PlainDate.from('2025-03-02');
    expect(Temporal.PlainDate.compare(
      Temporal.PlainDate.from(dueDate),
      expectedDate
    )).toBe(0);
  });

  it('should calculate due date for net_15 terms', async () => {
    // Create test client with net_15 terms
    const clientId = await context.createEntity('clients', {
      client_name: 'Test Client 2',
      payment_terms: 'net_15'
    }, 'client_id');

    const dueDate = await getDueDate(clientId, billingEndDate);
    const expectedDate = Temporal.PlainDate.from('2025-02-15');
    expect(Temporal.PlainDate.compare(
      Temporal.PlainDate.from(dueDate),
      expectedDate
    )).toBe(0);
  });

  it('should calculate due date for due_on_receipt terms', async () => {
    // Create test client with due_on_receipt terms
    const clientId = await context.createEntity('clients', {
      client_name: 'Test Client 2',
      payment_terms: 'due_on_receipt'
    }, 'client_id');

    const dueDate = await getDueDate(clientId, billingEndDate);
    const expectedDate = Temporal.PlainDate.from('2025-01-31');
    expect(Temporal.PlainDate.compare(
      Temporal.PlainDate.from(dueDate),
      expectedDate
    )).toBe(0);
  });

  it('should default to net_30 for unknown payment terms', async () => {
    // Create test client with unknown terms
    const clientId = await context.createEntity('clients', {
      client_name: 'Test Client 2',
      payment_terms: 'unknown'
    }, 'client_id');

    const dueDate = await getDueDate(clientId, billingEndDate);
    const expectedDate = Temporal.PlainDate.from('2025-03-02');
    expect(Temporal.PlainDate.compare(
      Temporal.PlainDate.from(dueDate),
      expectedDate
    )).toBe(0);
  });
});
