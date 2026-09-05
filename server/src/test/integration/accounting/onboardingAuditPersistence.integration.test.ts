import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import { TestContext } from '../../../../test-utils/testContext';

const helpers = TestContext.createHelpers();

const authRef = vi.hoisted(() => ({
  tenantId: '',
  userId: 'audit-test-user',
}));

// Inject the test user directly so per-test tenant rotation can't leave a
// stale session user (same pattern as the mapping integration tests).
vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn(
        { user_id: authRef.userId, tenant: authRef.tenantId, roles: [] },
        { tenant: authRef.tenantId },
        ...args
      ),
  hasPermission: vi.fn(async () => true),
  getCurrentUser: vi.fn(async () => null),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const REMOTE_CUSTOMER_NAME = 'Remote Customer One';

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getDefaultQboRealmId: vi.fn(async () => 'realm-audit-test'),
  QboClientService: { create: vi.fn() },
}));

vi.mock('@alga-psa/integrations/actions/qboActions', () => ({
  getQboCustomers: vi.fn(async () => [
    { id: 'qbo-cust-1', name: REMOTE_CUSTOMER_NAME, active: true },
  ]),
}));

import { getCustomerMatchCandidates } from '@alga-psa/billing/actions/qboOnboardingActions';

const HOOK_TIMEOUT = 120_000;

describe('Onboarding accounting catalog read auditing', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: ['tenant_external_entity_mappings', 'audit_logs'],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    authRef.tenantId = ctx.tenantId;
    authRef.userId = ctx.user.user_id;
    process.env.EDITION = 'ee';

    // Pin the onboarding action's connection to the test context DB.
    const algaDbModule = await import('@alga-psa/db');
    vi.spyOn(algaDbModule, 'createTenantKnex').mockResolvedValue({ knex: ctx.db, tenant: ctx.tenantId });
    await ctx.db('audit_logs').where({ tenant: ctx.tenantId }).delete();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  it('persists a count-only ACCOUNTING_CATALOG_READ row for the customer sweep', async () => {
    const { rows } = await getCustomerMatchCandidates();
    expect(Array.isArray(rows)).toBe(true);

    const auditRows = await ctx.db('audit_logs')
      .where({ tenant: ctx.tenantId, operation: 'ACCOUNTING_CATALOG_READ' })
      .select('*');

    // The read persisted exactly one audit row, tenant-scoped, carrying the
    // realm, the action, and counts only.
    expect(auditRows).toHaveLength(1);
    const audit = auditRows[0];
    expect(audit.tenant).toBe(ctx.tenantId);
    expect(audit.user_id).toBe(ctx.user.user_id);
    expect(audit.record_id).toBe('realm-audit-test');
    expect(audit.details).toMatchObject({
      action: 'getCustomerMatchCandidates',
      realm: 'realm-audit-test',
    });
    expect(typeof audit.details.localClients).toBe('number');
    expect(audit.details.remoteCustomers).toBe(1);

    // Counts only — no customer data (local names or the remote catalog
    // payload) may appear anywhere in the persisted record.
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(REMOTE_CUSTOMER_NAME);
    expect(serialized).not.toContain('qbo-cust-1');
    const localClientNames: Array<{ client_name: string }> = await ctx.db('clients')
      .where({ tenant: ctx.tenantId })
      .select('client_name');
    for (const { client_name } of localClientNames) {
      expect(serialized).not.toContain(client_name);
    }
  });
});
