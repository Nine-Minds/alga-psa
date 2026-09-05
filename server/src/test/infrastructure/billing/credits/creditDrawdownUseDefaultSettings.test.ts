import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../../test-utils/testContext';
import { resolveCreditDrawdownPolicy } from '@alga-psa/billing/actions/creditActions';
import { updateClientBillingSettings } from '@shared/billingClients/billingSettings';
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

function tenantTable<Row extends object = Record<string, unknown>>(
  context: TestContext,
  tableExpression: string
) {
  return tenantDb(context.db, context.tenantId).table<Row>(tableExpression);
}

describe('Credit Draw-Down "Use Default Settings" Data-Loss Fix', () => {
  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'client_billing_settings',
        'default_billing_settings',
        'contracts',
        'client_contracts',
      ],
      clientName: 'Credit Drawdown Use Default Client',
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

  it('reverting to defaults nulls only the draw-down fields and preserves unrelated overrides', async () => {
    const clientId = await createClient(context.db, context.tenantId, 'Use Default Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
    });

    const tenantEligibleTypeId = uuidv4();
    const clientEligibleTypeId = uuidv4();

    // Tenant defaults that differ from the hardcoded behavior-preserving ones,
    // so the assertion below proves the client reverts to *these* values.
    await tenantTable(context, 'default_billing_settings').insert({
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      credit_auto_apply_enabled: false,
      credit_application_order: 'oldest_first',
      credit_service_type_restriction_mode: 'restricted',
      credit_eligible_service_type_ids: JSON.stringify([tenantEligibleTypeId]),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const now = new Date().toISOString();
    await tenantTable(context, 'client_billing_settings').insert({
      tenant: context.tenantId,
      client_id: clientId,
      zero_dollar_invoice_handling: 'finalized',
      suppress_zero_dollar_invoices: true,
      enable_credit_expiration: true,
      credit_expiration_days: 90,
      credit_expiration_notification_days: [7],
      has_external_credit: true,
      external_credit_note: 'Paid through Dec 2026 by check',
      credit_auto_apply_enabled: true,
      credit_application_order: 'newest_first',
      credit_service_type_restriction_mode: 'restricted',
      credit_eligible_service_type_ids: JSON.stringify([clientEligibleTypeId]),
      created_at: now,
      updated_at: now,
    });

    // The exact payload the fixed UI sends for "Use Default Settings".
    await updateClientBillingSettings(context.db, context.tenantId, clientId, {
      creditAutoApplyEnabled: null,
      creditApplicationOrder: null,
      creditServiceTypeRestrictionMode: null,
    });

    const row = await tenantTable(context, 'client_billing_settings')
      .where({ client_id: clientId, tenant: context.tenantId })
      .first();

    expect(row).toBeDefined();

    // Unrelated overrides survive untouched.
    expect(row.zero_dollar_invoice_handling).toBe('finalized');
    expect(row.suppress_zero_dollar_invoices).toBe(true);
    expect(row.enable_credit_expiration).toBe(true);
    expect(row.credit_expiration_days).toBe(90);
    expect(row.credit_expiration_notification_days).toEqual([7]);
    expect(row.has_external_credit).toBe(true);
    expect(row.external_credit_note).toBe('Paid through Dec 2026 by check');

    // The three draw-down fields revert to inherit.
    expect(row.credit_auto_apply_enabled).toBeNull();
    expect(row.credit_application_order).toBeNull();
    expect(row.credit_service_type_restriction_mode).toBeNull();
    expect(row.credit_eligible_service_type_ids).toBeNull();

    // The resolved policy now follows the tenant defaults.
    const policy = await resolveCreditDrawdownPolicy(context.db, context.tenantId, clientId);
    expect(policy.autoApplyEnabled).toBe(false);
    expect(policy.applicationOrder).toBe('oldest_first');
    expect(policy.serviceTypeRestrictionMode).toBe('restricted');
    expect(policy.eligibleServiceTypeIds).toEqual([tenantEligibleTypeId]);

    // A subsequent single-field draw-down edit (e.g. toggling auto-apply) must
    // not clobber the unrelated overrides that survived Use Default.
    await updateClientBillingSettings(context.db, context.tenantId, clientId, {
      creditAutoApplyEnabled: true,
    });

    const rowAfterEdit = await tenantTable(context, 'client_billing_settings')
      .where({ client_id: clientId, tenant: context.tenantId })
      .first();

    expect(rowAfterEdit.zero_dollar_invoice_handling).toBe('finalized');
    expect(rowAfterEdit.suppress_zero_dollar_invoices).toBe(true);
    expect(rowAfterEdit.enable_credit_expiration).toBe(true);
    expect(rowAfterEdit.credit_expiration_days).toBe(90);
    expect(rowAfterEdit.credit_expiration_notification_days).toEqual([7]);
    expect(rowAfterEdit.has_external_credit).toBe(true);
    expect(rowAfterEdit.external_credit_note).toBe('Paid through Dec 2026 by check');

    expect(rowAfterEdit.credit_auto_apply_enabled).toBe(true);
    expect(rowAfterEdit.credit_application_order).toBeNull();
    expect(rowAfterEdit.credit_service_type_restriction_mode).toBeNull();
    expect(rowAfterEdit.credit_eligible_service_type_ids).toBeNull();

    const policyAfterEdit = await resolveCreditDrawdownPolicy(context.db, context.tenantId, clientId);
    expect(policyAfterEdit.autoApplyEnabled).toBe(true);
    expect(policyAfterEdit.applicationOrder).toBe('oldest_first');
    expect(policyAfterEdit.eligibleServiceTypeIds).toEqual([tenantEligibleTypeId]);
  });
});
