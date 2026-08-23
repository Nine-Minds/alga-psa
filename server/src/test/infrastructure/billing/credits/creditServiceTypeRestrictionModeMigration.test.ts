import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../../test-utils/testContext';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '../../../../../test-utils/testDataFactory';

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

const migration = require('../../../../../migrations/20260816120000_credit_service_type_restriction_mode.cjs');

function tenantTable<Row extends object = Record<string, unknown>>(
  context: TestContext,
  tableExpression: string
) {
  return tenantDb(context.db, context.tenantId).table<Row>(tableExpression);
}

async function deleteTenantRow() {
  await tenantTable(context, 'default_billing_settings')
    .where({ tenant: context.tenantId })
    .del();
}

describe('credit service-type restriction mode migration', () => {
  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      clientName: 'Credit Restriction Mode Migration Client',
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

  it('backfills tenant mode "restricted" from non-empty ids', async () => {
    await migration.down(context.db);
    await deleteTenantRow();

    const laborTypeId = uuidv4();
    await tenantTable(context, 'default_billing_settings').insert({
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      credit_eligible_service_type_ids: JSON.stringify([laborTypeId]),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await migration.up(context.db);

    const row = await tenantTable(context, 'default_billing_settings')
      .where({ tenant: context.tenantId })
      .first();
    expect(row.credit_service_type_restriction_mode).toBe('restricted');
    expect(row.credit_eligible_service_type_ids).toEqual([laborTypeId]);
  });

  it('backfills tenant mode "all" from null ids', async () => {
    await migration.down(context.db);
    await deleteTenantRow();

    await tenantTable(context, 'default_billing_settings').insert({
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      credit_eligible_service_type_ids: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await migration.up(context.db);

    const row = await tenantTable(context, 'default_billing_settings')
      .where({ tenant: context.tenantId })
      .first();
    expect(row.credit_service_type_restriction_mode).toBe('all');
    expect(row.credit_eligible_service_type_ids).toBeNull();
  });

  it('normalizes tenant empty-array ids to mode "all" and null ids', async () => {
    await migration.down(context.db);
    await deleteTenantRow();

    await tenantTable(context, 'default_billing_settings').insert({
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      credit_eligible_service_type_ids: JSON.stringify([]),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await migration.up(context.db);

    const row = await tenantTable(context, 'default_billing_settings')
      .where({ tenant: context.tenantId })
      .first();
    expect(row.credit_service_type_restriction_mode).toBe('all');
    expect(row.credit_eligible_service_type_ids).toBeNull();
  });

  it('backfills client mode from ids and leaves null ids inheriting (NULL mode)', async () => {
    await migration.down(context.db);

    const restrictedClient = await createClient(context.db, context.tenantId, 'Restricted Migration Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });
    const inheritClient = await createClient(context.db, context.tenantId, 'Inherit Migration Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });

    const laborTypeId = uuidv4();
    await tenantTable(context, 'client_billing_settings').insert([
      {
        tenant: context.tenantId,
        client_id: restrictedClient,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_eligible_service_type_ids: JSON.stringify([laborTypeId]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        tenant: context.tenantId,
        client_id: inheritClient,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_eligible_service_type_ids: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    await migration.up(context.db);

    const restricted = await tenantTable(context, 'client_billing_settings')
      .where({ client_id: restrictedClient, tenant: context.tenantId })
      .first();
    expect(restricted.credit_service_type_restriction_mode).toBe('restricted');
    expect(restricted.credit_eligible_service_type_ids).toEqual([laborTypeId]);

    const inherit = await tenantTable(context, 'client_billing_settings')
      .where({ client_id: inheritClient, tenant: context.tenantId })
      .first();
    expect(inherit.credit_service_type_restriction_mode).toBeNull();
    expect(inherit.credit_eligible_service_type_ids).toBeNull();
  });

  it('normalizes client empty-array ids to NULL mode and null ids', async () => {
    await migration.down(context.db);

    const clientId = await createClient(context.db, context.tenantId, 'Empty Array Migration Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });

    await tenantTable(context, 'client_billing_settings').insert({
      tenant: context.tenantId,
      client_id: clientId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      credit_eligible_service_type_ids: JSON.stringify([]),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await migration.up(context.db);

    const row = await tenantTable(context, 'client_billing_settings')
      .where({ client_id: clientId, tenant: context.tenantId })
      .first();
    expect(row.credit_service_type_restriction_mode).toBeNull();
    expect(row.credit_eligible_service_type_ids).toBeNull();
  });

  it('rejects tenant inserts violating each CHECK arm', async () => {
    await deleteTenantRow();

    // mode 'restricted' with null ids is rejected.
    await expect(
      tenantTable(context, 'default_billing_settings').insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_service_type_restriction_mode: 'restricted',
        credit_eligible_service_type_ids: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    ).rejects.toThrow();

    // mode 'all' with non-empty ids is rejected.
    await expect(
      tenantTable(context, 'default_billing_settings').insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_service_type_restriction_mode: 'all',
        credit_eligible_service_type_ids: JSON.stringify([uuidv4()]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    ).rejects.toThrow();

    // mode 'restricted' with an empty array is rejected.
    await expect(
      tenantTable(context, 'default_billing_settings').insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_service_type_restriction_mode: 'restricted',
        credit_eligible_service_type_ids: JSON.stringify([]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    ).rejects.toThrow();
  });

  it('rejects client inserts violating each CHECK arm', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Constraint Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });

    // mode 'restricted' with null ids is rejected.
    await expect(
      tenantTable(context, 'client_billing_settings').insert({
        tenant: context.tenantId,
        client_id: clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_service_type_restriction_mode: 'restricted',
        credit_eligible_service_type_ids: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    ).rejects.toThrow();

    // mode 'all' with non-empty ids is rejected.
    await expect(
      tenantTable(context, 'client_billing_settings').insert({
        tenant: context.tenantId,
        client_id: clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_service_type_restriction_mode: 'all',
        credit_eligible_service_type_ids: JSON.stringify([uuidv4()]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    ).rejects.toThrow();

    // NULL mode with non-empty ids is rejected (a restricted list must declare its mode).
    await expect(
      tenantTable(context, 'client_billing_settings').insert({
        tenant: context.tenantId,
        client_id: clientId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_service_type_restriction_mode: null,
        credit_eligible_service_type_ids: JSON.stringify([uuidv4()]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    ).rejects.toThrow();
  });
});
