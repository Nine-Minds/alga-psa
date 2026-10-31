import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ tables: new Set<string>(), result: { terminated: 0, unaccepted: 0 }, ended: vi.fn() }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: async () => ({ schema: { hasTable: async (name: string) => state.tables.has(name) } }),
  refreshAdminConnection: vi.fn(),
}));
vi.mock('@alga-psa/co-managed', () => ({
  endCoManagedSponsorshipsForDeletion: async (...args: unknown[]) => { state.ended(...args); return state.result; },
}));
vi.mock('@temporalio/client', () => ({ Client: vi.fn(), Connection: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn(), getTenantTableScope: vi.fn(), retryOnReadOnly: (op: () => Promise<unknown>) => op() }));
vi.mock('@alga-psa/shared/models/tagModel.js', () => ({ TagModel: {} }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: vi.fn() }));
vi.mock('../../db/tenant-operations.js', () => ({ insertStripeSubscriptionForTenant: vi.fn() }));
vi.mock('../../services/stripe-service.js', () => ({ updateSubscriptionMetadata: vi.fn() }));
vi.mock('../tenant-email-ingestion-activities.js', () => ({}));
vi.mock('../tenant-suspension-activities.js', () => ({}));
vi.mock('@temporalio/activity', () => ({ Context: { current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }) } }));

import { endTenantCoManagedSponsorships } from '../tenant-deletion-activities';

// Activity-level coverage only: there is no Temporal test environment on this host, so the
// workflow-level ordering is exercised by tenant-deletion-workflow.behavior.test.ts (mocked harness).
describe('endTenantCoManagedSponsorships (activity level)', () => {
  beforeEach(() => { state.tables.clear(); state.ended.mockReset(); state.result = { terminated: 0, unaccepted: 0 }; });

  it('is a no-op, not a failure, when the co-managed schema does not exist (DO-NOT-PORT #22)', async () => {
    await expect(endTenantCoManagedSponsorships('tenant-1')).resolves.toEqual({ terminated: 0, unaccepted: 0 });
    expect(state.ended).not.toHaveBeenCalled();
  });

  it('ends accepted relationships when the schema exists', async () => {
    state.tables.add('co_management_relationships');
    state.result = { terminated: 2, unaccepted: 0 };
    await expect(endTenantCoManagedSponsorships('tenant-1')).resolves.toEqual({ terminated: 2, unaccepted: 0 });
    expect(state.ended).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
  });

  it('fails explicitly rather than orphaning a setup the customer never accepted', async () => {
    state.tables.add('co_management_relationships');
    state.result = { terminated: 0, unaccepted: 1 };
    await expect(endTenantCoManagedSponsorships('tenant-1')).rejects.toThrow(/CLEANUP_INCOMPLETE/);
  });
});
