import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../../../../test-utils/nextApiMock';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../../../test-utils/testContext';
import { v4 as uuidv4 } from 'uuid';
import * as creditActionsModule from '@alga-psa/billing/actions/creditActions';
import { resolveCreditDrawdownPolicy } from '@alga-psa/billing/actions/creditActions';

const creditActionsSource = readFileSync(
    fileURLToPath(new URL('../../../../../../packages/billing/src/actions/creditActions.ts', import.meta.url)),
    'utf8'
);

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

describe('credit draw-down policy module load', () => {
  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      clientName: 'Policy Module Load Client',
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

  it('loads the server module path and exposes only value exports', () => {
    // The server and client import these names through the same alias the smoke
    // stack resolves; importing the namespace here is the module-load path that
    // previously threw a ReferenceError for a type re-exported as a value.
    expect(typeof creditActionsModule.resolveCreditDrawdownPolicy).toBe('function');
    expect(creditActionsModule.getResolvedCreditDrawdownPolicy).toBeDefined();

    // `CreditApplicationOrder` and `CreditDrawdownPolicy` are types. They must
    // never appear as runtime exports — the Next flight loader treats a
    // type-only re-export as a value and throws `ReferenceError` at module scope.
    expect('CreditApplicationOrder' in creditActionsModule).toBe(false);
    expect('CreditDrawdownPolicy' in creditActionsModule).toBe(false);
  });

  it('does not re-export type-only names (Turbopack server-action ReferenceError regression)', () => {
    // Vitest's esbuild transform strips `export type { X }` correctly, so the
    // namespace assertions above pass even on the broken revision. The runtime
    // failure was Turbopack-specific: a `'use server'` module that re-exports a
    // type-only import via `export type { ... }` is emitted with the type name as
    // a value re-export, and evaluating it throws `ReferenceError: X is not
    // defined` for everyone who transitively imports the module (client policy
    // load, contract detail, invoicing, manual-credit UI, invoice GET/POST).
    // Guard the source so the exact broken shape cannot come back.
    expect(creditActionsSource).not.toMatch(/export\s+type\s*\{[^}]*\bCreditApplicationOrder\b/);
    expect(creditActionsSource).not.toMatch(/export\s+type\s*\{[^}]*\bCreditDrawdownPolicy\b/);
  });

  it('resolves a policy end-to-end: tenant default, then client override', async () => {
    const laborTypeId = uuidv4();
    await tenantTable(context, 'service_types').insert({
      id: laborTypeId,
      tenant: context.tenantId,
      name: 'Labor',
      is_active: true,
    });

    const now = new Date().toISOString();
    await tenantTable(context, 'default_billing_settings')
      .insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        credit_auto_apply_enabled: false,
        credit_application_order: 'newest_first',
        credit_eligible_service_type_ids: JSON.stringify([laborTypeId]),
        created_at: now,
        updated_at: now,
      })
      .onConflict('tenant')
      .merge();

    // No client row yet: inherit the tenant defaults.
    const inherited = await resolveCreditDrawdownPolicy(context.db, context.tenantId, context.clientId);
    expect(inherited).toEqual({
      autoApplyEnabled: false,
      applicationOrder: 'newest_first',
      eligibleServiceTypeIds: [laborTypeId],
    });

    // Client overrides only the application order; the rest inherit.
    await tenantTable(context, 'client_billing_settings').insert({
      client_id: context.clientId,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: false,
      credit_auto_apply_enabled: null,
      credit_application_order: 'oldest_first',
      credit_eligible_service_type_ids: null,
      created_at: now,
      updated_at: now,
    });

    const overridden = await resolveCreditDrawdownPolicy(context.db, context.tenantId, context.clientId);
    expect(overridden).toEqual({
      autoApplyEnabled: false,
      applicationOrder: 'oldest_first',
      eligibleServiceTypeIds: [laborTypeId],
    });
  });
});
