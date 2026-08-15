import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../../test-utils/testContext';
import { v4 as uuidv4 } from 'uuid';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

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

const migration = require('../../../../../migrations/20260815120000_add_invoice_credit_permission.cjs');

function tenantTable<Row extends object = Record<string, unknown>>(
  context: TestContext,
  tableExpression: string
) {
  return tenantDb(context.db, context.tenantId).table<Row>(tableExpression);
}

describe('invoice:credit permission migration', () => {
  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      clientName: 'Invoice Credit Permission Client',
      userType: 'internal',
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });

    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;
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
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('seeds invoice:credit and grants it to Admin and Finance MSP roles', async () => {
    const adminRoleId = uuidv4();
    const financeRoleId = uuidv4();
    const technicianRoleId = uuidv4();

    await tenantTable(context, 'roles').insert([
      { tenant: context.tenantId, role_id: adminRoleId, role_name: 'Admin', msp: true, client: false },
      { tenant: context.tenantId, role_id: financeRoleId, role_name: 'Finance', msp: true, client: false },
      { tenant: context.tenantId, role_id: technicianRoleId, role_name: 'Technician', msp: true, client: false },
    ]);

    await migration.up(context.db);

    const permission = await tenantTable(context, 'permissions')
      .where({ tenant: context.tenantId, resource: 'invoice', action: 'credit' })
      .first();
    expect(permission).toBeDefined();
    expect(permission.msp).toBe(true);
    expect(permission.client).toBe(false);

    const grantedRoleIds = await tenantTable(context, 'role_permissions')
      .where({ tenant: context.tenantId, permission_id: permission.permission_id })
      .select('role_id');
    const grantedSet = new Set(grantedRoleIds.map((row) => row.role_id));

    expect(grantedSet.has(adminRoleId)).toBe(true);
    expect(grantedSet.has(financeRoleId)).toBe(true);
    expect(grantedSet.has(technicianRoleId)).toBe(false);
  });
});
