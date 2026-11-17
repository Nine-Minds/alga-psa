import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  existing: null as null | { run_tenant_id: string },
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => {
      const chain: any = {
        where: () => chain,
        first: async () => hoisted.existing,
        update: async (row: Record<string, unknown>) => { hoisted.updates.push(row); },
        insert: async (row: Record<string, unknown>) => { hoisted.inserts.push(row); },
      };
      return chain;
    },
  }),
  isTenantSuspended: vi.fn(),
  retryOnTenantReadOnly: vi.fn(),
}));
vi.mock('@alga-psa/db/tenant', () => ({ createTenantKnex: vi.fn(), runWithTenant: vi.fn() }));
vi.mock('@alga-psa/db/admin.js', () => ({ getAdminConnection: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildClientCreatedPayload: vi.fn() }));
vi.mock('@ee/lib/integrations/entra/providers', () => ({ getEntraProviderAdapter: vi.fn() }));
vi.mock('@ee/lib/integrations/entra/sync/syncEngine', () => ({ executeEntraSync: vi.fn() }));
vi.mock('@ee/lib/integrations/entra/sync/clientPortalProvisioning', () => ({ handleIneligibleClientPortalLifecycle: vi.fn() }));
vi.mock('@ee/lib/integrations/entra/sync/workflowManagedProvisioning', () => ({ publishWorkflowManagedPortalProvisioningEvent: vi.fn() }));
vi.mock('@ee/lib/integrations/entra/sync/clientProvisioningService', () => ({ provisionEntraClientForMapping: vi.fn() }));
vi.mock('@ee/lib/integrations/entra/sync/completedSyncUserCountService', () => ({
  projectCompletedSyncUserCount: vi.fn(async () => false),
}));
vi.mock('@ee/lib/integrations/entra/settingsService', () => ({ filterEntraUsersForManagedTenant: vi.fn() }));
vi.mock('@ee/lib/integrations/entra/sync/disableHandler', () => ({ excludeSharedMailboxEntraIdentities: vi.fn() }));
vi.mock('@ee/lib/integrations/entra/notifications/entraSyncNotificationRules', () => ({ decideEntraRunNotifications: vi.fn() }));

const knex = { fn: { now: () => 'now' }, raw: (sql: string, bindings: unknown[]) => ({ sql, bindings }) } as any;

function issue(index: number, severity: 'failure' | 'notice' = 'failure') {
  return {
    severity,
    stage: 'create' as const,
    entraObjectId: `o${index}`,
    userPrincipalName: `u${index}@example.com`,
    displayName: `User ${index}`,
    message: `boom ${index}`,
  };
}

const baseResult = {
  managedTenantId: 'managed-1',
  clientId: 'client-1',
  status: 'completed' as const,
  created: 1,
  linked: 0,
  updated: 0,
  ambiguous: 0,
  inactivated: 0,
  skipped: 0,
};

describe('recordSyncTenantResultWithDb per-user issues', () => {
  beforeEach(() => {
    hoisted.inserts.length = 0;
    hoisted.updates.length = 0;
    hoisted.existing = null;
  });

  it('T007: writes failed_count and user_issues on insert', async () => {
    const { recordSyncTenantResultWithDb } = await import('../entra-sync-activities');
    await recordSyncTenantResultWithDb(knex, {
      tenantId: 'tenant-1',
      runId: 'run-1',
      result: { ...baseResult, failed: 1, userIssues: [issue(1)] },
    } as any);

    expect(hoisted.inserts).toHaveLength(1);
    expect(hoisted.inserts[0].failed_count).toBe(1);
    expect(hoisted.inserts[0].user_issues).toEqual({ sql: '?::jsonb', bindings: [JSON.stringify([issue(1)])] });
  });

  it('T007: caps user_issues at 100 but keeps the true failed_count; update never sets tenant', async () => {
    hoisted.existing = { run_tenant_id: 'rt-1' };
    const issues = Array.from({ length: 150 }, (_, index) => issue(index));
    const { recordSyncTenantResultWithDb } = await import('../entra-sync-activities');
    await recordSyncTenantResultWithDb(knex, {
      tenantId: 'tenant-1',
      runId: 'run-1',
      result: { ...baseResult, failed: 150, userIssues: issues },
    } as any);

    expect(hoisted.updates).toHaveLength(1);
    expect(hoisted.updates[0].failed_count).toBe(150);
    const bindings = (hoisted.updates[0].user_issues as { bindings: string[] }).bindings;
    expect(JSON.parse(bindings[0])).toHaveLength(100);
    expect(hoisted.updates[0]).not.toHaveProperty('tenant');
  });

  it('T007: 150 notices followed by 3 failures still persists all 3 failures', async () => {
    const issues = [
      ...Array.from({ length: 150 }, (_, index) => issue(index, 'notice')),
      issue(1000), issue(1001), issue(1002),
    ];
    const { recordSyncTenantResultWithDb } = await import('../entra-sync-activities');
    await recordSyncTenantResultWithDb(knex, {
      tenantId: 'tenant-1',
      runId: 'run-1',
      result: { ...baseResult, failed: 3, userIssues: issues },
    } as any);

    const stored = JSON.parse((hoisted.inserts[0].user_issues as { bindings: string[] }).bindings[0]);
    expect(stored).toHaveLength(100);
    expect(stored.filter((entry: { severity: string }) => entry.severity === 'failure')).toHaveLength(3);
    expect(stored.slice(0, 3).map((entry: { entraObjectId: string }) => entry.entraObjectId)).toEqual(['o1000', 'o1001', 'o1002']);
  });

  it('T007: defaults to 0 failures and an empty list when the result carries none', async () => {
    const { recordSyncTenantResultWithDb } = await import('../entra-sync-activities');
    await recordSyncTenantResultWithDb(knex, {
      tenantId: 'tenant-1',
      runId: 'run-1',
      result: { ...baseResult },
    } as any);

    expect(hoisted.inserts[0].failed_count).toBe(0);
    expect((hoisted.inserts[0].user_issues as { bindings: string[] }).bindings[0]).toBe('[]');
  });
});
