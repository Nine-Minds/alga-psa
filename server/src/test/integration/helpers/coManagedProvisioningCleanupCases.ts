import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { tenantDb, runWithTenant } from '@alga-psa/db';
import { getCoManagedEntitlementState } from '@alga-psa/licensing';
import { requestCoManagedProvisioningCleanup, runCoManagedProvisioningCleanup,
  completeCoManagedProvisioningCleanup, type CoManagedProvisioningOperation } from '../../../../../packages/co-managed/src/provisioning';
import { bootstrapCoManagedWorkspace } from '../../../../../ee/temporal-workflows/src/db/co-managed-provisioning-operations';
import { deleteCoManagedProvisioningRows } from '../../../../../ee/temporal-workflows/src/db/co-managed-provisioning-cleanup';
import { cleanupCoManagedCustomer } from '../../../../../ee/temporal-workflows/src/activities/co-managed-provisioning-activities';
import { TENANT_TABLES_DELETION_ORDER } from '../../../../../ee/temporal-workflows/src/activities/tenant-deletion-activities';

export function registerCoManagedProvisioningCleanupTests(getDb: () => Knex, prepare: () => Promise<CoManagedProvisioningOperation>) {
  async function fixture(bootstrap = true) {
    const db = getDb(), operation = await prepare();
    if (bootstrap) await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, { info() {}, warn() {}, error() {} });
    const home = tenantDb(db, operation.tenant), customer = tenantDb(db, operation.customer_tenant);
    const input = { sponsorTenant: operation.tenant, operationId: operation.operation_id };
    return { db, operation, home, customer, input, cancel: () => requestCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId),
      cleanup: () => cleanupCoManagedCustomer(input), stored: () => home.table('co_managed_provisioning_operations').first(),
      allocation: () => home.table('co_managed_allocations').first() };
  }
  async function signup(f: Awaited<ReturnType<typeof fixture>>) {
    const invitation = await f.customer.table('user_invitations').first();
    const { UserService } = await import('../../../../../packages/users/src/services/UserService');
    const service = new UserService();
    vi.spyOn(service as any, 'ensurePermission').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: f.db });
    vi.spyOn(service as any, 'enhanceUsersWithDetails').mockImplementation(async (rows: unknown) => rows);
    return () => runWithTenant(f.operation.customer_tenant, () => service.createFromInvitation(invitation.token,
      'Initial-customer-password-42!', { tenant: f.operation.customer_tenant, userId: randomUUID() }));
  }
  describe('co-managed provisioning cleanup', () => {
    it('cancels a queued workspace without creating it and acknowledges capacity release exactly once', async () => {
      const f = await fixture(false);
      await f.cancel(); expect(await f.allocation()).toMatchObject({ state: 'reserved', released_at: null });
      expect(await getCoManagedEntitlementState(f.db, f.operation.tenant)).toMatchObject({ available: 0 });
      await Promise.all([f.cleanup(), f.cleanup()]);
      const allocation = await f.allocation(), relationship = await f.customer.table('co_management_relationships').first();
      expect(allocation).toMatchObject({ state: 'released' }); expect(allocation.released_at).not.toBeNull();
      expect(await f.stored()).toMatchObject({ state: 'cancelled' });
      expect(await f.customer.table('tenants')).toEqual([]);
      expect(relationship).toMatchObject({ relationship_id: f.operation.relationship_id, sponsor_tenant: f.operation.tenant, state: 'terminated' });
      await f.cancel(); await f.cleanup();
      expect(await f.allocation()).toEqual(allocation); expect(await f.customer.table('co_management_relationships').first()).toEqual(relationship);
      expect(await getCoManagedEntitlementState(f.db, f.operation.tenant)).toMatchObject({ allocated: 0, available: 2 });
    });
    it('cleans the real bootstrapped defaults and invitation while retaining the MSP, siblings and reservation tombstone', async () => {
      const f = await fixture(), sibling = await fixture();
      const invitation = await f.customer.table('user_invitations').first(), siblingTenant = await sibling.customer.table('tenants').first();
      await f.cancel();
      await expect(bootstrapCoManagedWorkspace(f.db, f.operation.tenant, f.operation.operation_id, { info() {}, warn() {}, error() {} }))
        .rejects.toMatchObject({ code: 'OPERATION_CLOSED' });
      await f.cleanup();
      for (const table of ['tenants', 'boards', 'statuses', 'contacts', 'clients', 'roles', 'permissions', 'user_invitations'])
        expect(await f.customer.table(table)).toEqual([]);
      expect(await f.home.table('tenants')).toHaveLength(1); expect(await f.home.table('clients')).toHaveLength(1);
      expect(await sibling.customer.table('tenants').first()).toEqual(siblingTenant);
      expect(await sibling.customer.table('user_invitations')).toHaveLength(1);
      expect(await f.customer.table('user_invitations').where('token', invitation.token)).toEqual([]);
      expect(await f.stored()).toMatchObject({ state: 'cancelled' });
    });
    it('rolls back data deletion and retains seats on failure, then resumes the same operation', async () => {
      const f = await fixture(); await f.cancel();
      const before = await f.customer.table('tenants').first();
      await expect(runCoManagedProvisioningCleanup(f.db, f.operation.tenant, f.operation.operation_id, async (trx, operation) => {
        await deleteCoManagedProvisioningRows(trx, operation, TENANT_TABLES_DELETION_ORDER);
        throw new Error('Cleanup acknowledgement lost before commit');
      })).rejects.toThrow('acknowledgement lost');
      expect(await f.customer.table('tenants').first()).toEqual(before);
      expect(await f.customer.table('user_invitations')).toHaveLength(1);
      expect(await f.allocation()).toMatchObject({ state: 'reserved', released_at: null });
      await f.cleanup(); expect(await f.stored()).toMatchObject({ state: 'cancelled' });
    });
    it('records retryable cleanup failure for unknown tenant data instead of releasing its reservation', async () => {
      const f = await fixture(); await f.cancel();
      const table = `cleanup_unknown_${randomUUID().replaceAll('-', '')}`;
      await f.db.schema.createTable(table, definition => { definition.uuid('tenant'); definition.text('payload'); });
      try {
        await f.db(table).insert({ tenant: f.operation.customer_tenant, payload: 'must not abandon' });
        await expect(f.cleanup()).rejects.toMatchObject({ code: 'CLEANUP_INCOMPLETE' });
        expect(await f.stored()).toMatchObject({ state: 'cleanup_requested', error_code: 'PROVISIONING_CLEANUP_FAILED' });
        expect(await f.allocation()).toMatchObject({ state: 'reserved', released_at: null });
        expect(await f.customer.table('tenants')).toHaveLength(1);
        expect(await f.db(table).where('tenant', f.operation.customer_tenant)).toHaveLength(1);
      } finally { await f.db.schema.dropTable(table); }
      await f.cleanup(); expect(await f.stored()).toMatchObject({ state: 'cancelled', error_code: null });
    });
    it('does not delete a workspace after its initial administrator signs up while acceptance is still pending', async () => {
      const f = await fixture(), create = await signup(f); await create();
      const users = await f.customer.table('users');
      expect(await f.customer.table('co_management_relationships').first()).toMatchObject({ state: 'pending_acceptance' });
      await expect(f.cancel()).rejects.toMatchObject({ code: 'ADMINISTRATOR_CLAIMED' });
      // The destructive worker and direct acknowledgment also defend a stale/altered cleanup state.
      await f.home.table('co_managed_provisioning_operations').update({ state: 'cleanup_requested' });
      await expect(f.cleanup()).rejects.toMatchObject({ code: 'ADMINISTRATOR_CLAIMED' });
      await expect(completeCoManagedProvisioningCleanup(f.db, f.operation.tenant, f.operation.operation_id)).rejects.toMatchObject({ code: 'ADMINISTRATOR_CLAIMED' });
      expect(await f.customer.table('users')).toEqual(users); expect(await f.customer.table('tenants')).toHaveLength(1);
      expect(await f.allocation()).toMatchObject({ state: 'reserved' });
    });
    it('serializes first signup against cancellation so only one can claim the workspace', async () => {
      const f = await fixture(), create = await signup(f);
      const outcomes = await Promise.allSettled([create(), f.cancel()]);
      expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      if (outcomes[0].status === 'fulfilled') {
        expect(await f.customer.table('users')).toHaveLength(1);
        expect(await f.stored()).toMatchObject({ state: 'pending_acceptance' });
      } else {
        expect(await f.customer.table('users')).toEqual([]); await f.cleanup();
        expect(await f.stored()).toMatchObject({ state: 'cancelled' });
      }
    });
    it('rejects a foreign sponsor, missing cancellation request and accepted relationship before deleting rows', async () => {
      const f = await fixture();
      await expect(cleanupCoManagedCustomer({ ...f.input, sponsorTenant: randomUUID() })).rejects.toThrow();
      await expect(f.cleanup()).rejects.toMatchObject({ code: 'OPERATION_CLOSED' });
      await f.customer.table('co_management_relationships').update({ state: 'active', accepted_at: new Date(), accepted_by: randomUUID() });
      await expect(f.cancel()).rejects.toMatchObject({ code: 'RELATIONSHIP_ACTIVE' });
      await expect(f.cleanup()).rejects.toMatchObject({ code: 'RELATIONSHIP_ACTIVE' });
      expect(await f.customer.table('tenants')).toHaveLength(1); expect(await f.allocation()).toMatchObject({ state: 'reserved' });
    });
  });
}
