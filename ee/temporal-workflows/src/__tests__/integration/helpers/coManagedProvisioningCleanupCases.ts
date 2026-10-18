import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { tenantDb, runWithTenant } from '@alga-psa/db';
import { getCoManagedEntitlementState } from '@alga-psa/licensing';
import { requestCoManagedProvisioningCleanup, runCoManagedProvisioningCleanup,
  completeCoManagedProvisioningCleanup, type CoManagedProvisioningOperation } from '../../../../../../packages/co-managed/src/provisioning';
import { bootstrapCoManagedWorkspace } from '../../../db/co-managed-provisioning-operations';
import { deleteCoManagedProvisioningRows } from '../../../db/co-managed-provisioning-cleanup';
import { cleanupCoManagedCustomer } from '../../../activities/co-managed-provisioning-activities';
import { acceptCoManagedRelationship, getCoManagedAcceptanceState } from '../../../../../../packages/co-managed/src/acceptance';
import { TENANT_TABLES_DELETION_ORDER } from '../../../activities/tenant-deletion-activities';

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
    const { UserService } = await import('../../../../../../packages/users/src/services/UserService');
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
    it('cancels after the initial administrator signs up but before acceptance, deleting the account with the workspace', async () => {
      // Until the customer accepts, the workspace is the MSP's unactivated
      // proposal. A claimed administrator must not strand it (and its seats)
      // with no way for either side to end it.
      const f = await fixture(), create = await signup(f); const user = await create();
      expect(await f.customer.table('co_management_relationships').first()).toMatchObject({ state: 'pending_acceptance' });
      await f.cancel();
      expect(await getCoManagedAcceptanceState(f.db, { tenant: f.operation.customer_tenant, userId: user.user_id }))
        .toMatchObject({ state: 'cancelled' });
      await expect(acceptCoManagedRelationship(f.db, { tenant: f.operation.customer_tenant, userId: user.user_id },
        { relationshipId: f.operation.relationship_id, revision: 1, scopeFingerprint: 'stale' })).rejects.toThrow();
      await f.cleanup();
      expect(await f.customer.table('users')).toEqual([]); expect(await f.customer.table('tenants')).toEqual([]);
      expect(await f.allocation()).toMatchObject({ state: 'released' });
      expect(await f.stored()).toMatchObject({ state: 'cancelled' });
      expect(await f.customer.table('co_management_relationships').first()).toMatchObject({ state: 'terminated' });
    });
    it('serializes first signup against cancellation so a cancelled workspace cannot be claimed', async () => {
      const f = await fixture(), create = await signup(f);
      const [signup_, cancel] = await Promise.allSettled([create(), f.cancel()]);
      // Cancellation wins either way; signup only succeeds if it committed first.
      expect(cancel.status).toBe('fulfilled');
      expect(await f.stored()).toMatchObject({ state: 'cleanup_requested' });
      expect(await f.customer.table('users')).toHaveLength(signup_.status === 'fulfilled' ? 1 : 0);
      await f.cleanup();
      expect(await f.customer.table('users')).toEqual([]);
      expect(await f.stored()).toMatchObject({ state: 'cancelled' });
    });
    it('refuses signup once cancellation was requested', async () => {
      const f = await fixture(), create = await signup(f);
      await f.cancel();
      await expect(create()).rejects.toThrow();
      expect(await f.customer.table('users')).toEqual([]);
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
