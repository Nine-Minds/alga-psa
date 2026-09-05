import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks, mockRBAC } from '../../../../../test-utils/testMocks';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../../test-utils/testContext';
import { updateClientContractLineSettingsAsync } from '@alga-psa/clients/lib/billingHelpers';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { createClient } from '../../../../../test-utils/testDataFactory';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

// The wrapped server action resolves its own connection via createTenantKnex();
// point it at the TestContext connection so the write (or its absence) is
// observable on the same transaction the assertions read.
const testDbRef: { db: any } = { db: null };

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null,
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any)),
    createTenantKnex: vi.fn(async () => ({ knex: testDbRef.db, tenant: mockedTenantId })),
  };
});

vi.mock('@alga-psa/core/logger', () => {
  const noop = vi.fn();
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: vi.fn(() => logger),
  };
  return { default: logger };
});

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(() =>
    Promise.resolve({
      user_id: mockedUserId,
      tenant: mockedTenantId,
      username: 'mock-user',
      first_name: 'Mock',
      last_name: 'User',
      email: 'mock.user@example.com',
      user_type: 'internal',
      roles: [],
    })
  ),
}));

vi.mock('@alga-psa/auth', async () => {
  const { createAuthModuleMock } = await import('../../../../../test-utils/authModuleMock');
  return createAuthModuleMock();
});

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

let context: TestContext;

function tenantTable<Row extends object = Record<string, unknown>>(
  context: TestContext,
  tableExpression: string
) {
  return tenantDb(context.db, context.tenantId).table<Row>(tableExpression);
}

async function seedClientWithSettings(): Promise<string> {
  const clientId = await createClient(context.db, context.tenantId, 'Drawdown RBAC Client', {
    billing_cycle: 'monthly',
    region_code: 'US-NY',
    is_tax_exempt: false,
  });

  const now = new Date().toISOString();
  await tenantTable(context, 'client_billing_settings').insert({
    tenant: context.tenantId,
    client_id: clientId,
    zero_dollar_invoice_handling: 'finalized',
    suppress_zero_dollar_invoices: true,
    credit_auto_apply_enabled: true,
    credit_application_order: 'newest_first',
    created_at: now,
    updated_at: now,
  });

  return clientId;
}

describe('Client billing settings write RBAC (billing_settings:update)', () => {
  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'client_billing_settings',
        'default_billing_settings',
        'contracts',
        'client_contracts',
      ],
      clientName: 'Credit Drawdown RBAC Client',
      userType: 'internal',
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
    testDbRef.db = context.db;
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
    testDbRef.db = context.db;
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('denies the write without billing_settings:update and leaves the row unchanged', async () => {
    const clientId = await seedClientWithSettings();

    // Authenticated, but missing the billing_settings:update grant.
    mockRBAC((_user, resource, action) => !(resource === 'billing_settings' && action === 'update'));

    const result = await updateClientContractLineSettingsAsync(clientId, {
      creditAutoApplyEnabled: false,
      creditApplicationOrder: 'oldest_first',
    });

    expect(isActionPermissionError(result)).toBe(true);
    if (isActionPermissionError(result)) {
      expect(result.permissionError).toBe('Permission denied: Cannot update billing settings');
    }

    const row = await tenantTable(context, 'client_billing_settings')
      .where({ client_id: clientId, tenant: context.tenantId })
      .first();

    expect(row).toBeDefined();
    expect(row.credit_auto_apply_enabled).toBe(true);
    expect(row.credit_application_order).toBe('newest_first');
    expect(row.zero_dollar_invoice_handling).toBe('finalized');
    expect(row.suppress_zero_dollar_invoices).toBe(true);
  });

  it('permits the write with billing_settings:update', async () => {
    const clientId = await seedClientWithSettings();

    mockRBAC(() => true);

    const result = await updateClientContractLineSettingsAsync(clientId, {
      creditAutoApplyEnabled: false,
      creditApplicationOrder: 'oldest_first',
    });

    expect(isActionPermissionError(result)).toBe(false);
    expect(result).toEqual({ success: true });

    const row = await tenantTable(context, 'client_billing_settings')
      .where({ client_id: clientId, tenant: context.tenantId })
      .first();

    expect(row.credit_auto_apply_enabled).toBe(false);
    expect(row.credit_application_order).toBe('oldest_first');
    // The gate sits in front of the same shared update path; unrelated
    // overrides still survive a permitted partial write.
    expect(row.zero_dollar_invoice_handling).toBe('finalized');
    expect(row.suppress_zero_dollar_invoices).toBe(true);
  });
});
