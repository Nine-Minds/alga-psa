import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ tables: new Set<string>(), result: { terminated: 0, unaccepted: 0 }, ended: vi.fn(), released: vi.fn(), probes: [] as string[], customer: { released: 0, relationships: 0 } }));
vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: async () => ({ schema: { hasTable: async (name: string) => { state.probes.push(name); return state.tables.has(name); } } }),
  refreshAdminConnection: vi.fn(),
}));
vi.mock('@alga-psa/co-managed', () => ({
  endCoManagedSponsorshipsForDeletion: async (...args: unknown[]) => { state.ended(...args); return state.result; },
  releaseCoManagedSeatsForCustomerDeletion: async (...args: unknown[]) => { state.released(...args); return state.customer; },
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

import { endTenantCoManagedSponsorships } from '../co-managed-tenant-deletion-activities';

// Activity-level coverage only: there is no Temporal test environment on this host, so the
// workflow-level ordering is exercised by tenant-deletion-workflow.behavior.test.ts (mocked harness).
describe('endTenantCoManagedSponsorships (activity level)', () => {
  beforeEach(() => {
    state.tables.clear(); state.ended.mockReset(); state.released.mockReset(); state.probes.length = 0;
    state.result = { terminated: 0, unaccepted: 0 }; state.customer = { released: 0, relationships: 0 };
  });

  it('is a no-op, not a failure, when the co-managed schema does not exist (DO-NOT-PORT #22): one hasTable probe, nothing else', async () => {
    await expect(endTenantCoManagedSponsorships('tenant-1')).resolves.toEqual({ terminated: 0, unaccepted: 0, releasedSeats: 0 });
    expect(state.probes).toEqual(['co_management_relationships']);
    expect(state.ended).not.toHaveBeenCalled();
    expect(state.released).not.toHaveBeenCalled();
  });

  it('is a no-op for a tenant with the schema but no relationships: nothing ended, nothing thrown', async () => {
    state.tables.add('co_management_relationships'); state.tables.add('co_managed_allocations'); state.tables.add('co_managed_entitlements');
    await expect(endTenantCoManagedSponsorships('tenant-1')).resolves.toEqual({ terminated: 0, unaccepted: 0, releasedSeats: 0 });
  });

  it('ends accepted relationships when the schema exists', async () => {
    state.tables.add('co_management_relationships');
    state.result = { terminated: 2, unaccepted: 0 };
    await expect(endTenantCoManagedSponsorships('tenant-1')).resolves.toEqual({ terminated: 2, unaccepted: 0, releasedSeats: 0 });
    expect(state.ended).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
  });

  it('releases the sponsor seat when the deleted tenant is a co-managed customer, and skips the ledger when its tables are absent', async () => {
    state.tables.add('co_management_relationships');
    await endTenantCoManagedSponsorships('tenant-1');
    expect(state.released).not.toHaveBeenCalled();
    state.tables.add('co_managed_allocations'); state.tables.add('co_managed_entitlements');
    state.customer = { released: 3, relationships: 1 };
    await expect(endTenantCoManagedSponsorships('tenant-1')).resolves.toEqual({ terminated: 0, unaccepted: 0, releasedSeats: 3 });
    expect(state.released).toHaveBeenCalledWith(expect.anything(), 'tenant-1');
  });

  it('fails explicitly rather than orphaning a setup the customer never accepted (new sponsor-deletion failure mode)', async () => {
    state.tables.add('co_management_relationships');
    state.result = { terminated: 0, unaccepted: 1 };
    await expect(endTenantCoManagedSponsorships('tenant-1')).rejects.toThrow(/CLEANUP_INCOMPLETE/);
  });
});
