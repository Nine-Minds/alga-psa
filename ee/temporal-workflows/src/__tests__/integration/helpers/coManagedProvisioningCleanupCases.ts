import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState } from '@alga-psa/licensing';
import { requestCoManagedProvisioningCleanup, runCoManagedProvisioningCleanup, type CoManagedProvisioningOperation } from '../../../../../../packages/co-managed/src/provisioning';
import { bootstrapCoManagedWorkspace } from '../../../db/co-managed-provisioning-operations';
import { deleteCoManagedProvisioningRows } from '../../../db/co-managed-provisioning-cleanup';
import { cleanupCoManagedCustomer } from '../../../activities/co-managed-provisioning-activities';
import { TENANT_TABLES_DELETION_ORDER } from '../../../activities/tenant-deletion-activities';

const log = { info() {}, warn() {}, error() {} };

export function registerCoManagedProvisioningCleanupTests(getDb: () => Knex, prepare: () => Promise<CoManagedProvisioningOperation>) {
  async function fixture(bootstrap = true) {
    const db = getDb(), operation = await prepare();
    if (bootstrap) await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
    const home = tenantDb(db, operation.tenant), customer = tenantDb(db, operation.customer_tenant);
    const input = { sponsorTenant: operation.tenant, operationId: operation.operation_id };
    return { db, operation, home, customer, input,
      cancel: () => requestCoManagedProvisioningCleanup(db, input.sponsorTenant, input.operationId),
      cleanup: () => cleanupCoManagedCustomer(input), stored: () => home.table('co_managed_provisioning_operations').first(),
      allocation: () => home.table('co_managed_allocations').first() };
  }
  describe('co-managed provisioning cleanup', () => {
    it('cancels a queued workspace without creating it and releases seats exactly once', async () => {
      const f = await fixture(false);
      await f.cancel();
      expect(await f.stored()).toMatchObject({ state: 'cleanup_requested' });
      expect(await f.allocation()).toMatchObject({ state: 'reserved', released_at: null });
      expect(await getCoManagedEntitlementState(f.db, f.operation.tenant)).toMatchObject({ available: 2 });
      await Promise.all([f.cleanup(), f.cleanup()]);
      const allocation = await f.allocation(), relationship = await f.customer.table('co_management_relationships').first();
      expect(allocation).toMatchObject({ state: 'released' }); expect(allocation.released_at).not.toBeNull();
      expect(await f.stored()).toMatchObject({ state: 'cancelled' });
      expect(await f.customer.table('tenants')).toEqual([]);
      expect(relationship).toMatchObject({ relationship_id: f.operation.relationship_id, sponsor_tenant: f.operation.tenant, state: 'terminated' });
      // Repeating cancel and cleanup changes nothing: seats are returned once.
      await f.cancel(); await f.cleanup();
      expect(await f.allocation()).toEqual(allocation);
      expect(await f.customer.table('co_management_relationships').first()).toEqual(relationship);
      expect(await getCoManagedEntitlementState(f.db, f.operation.tenant)).toMatchObject({ allocated: 0, available: 4 });
    });
    it('cleans the real bootstrapped defaults and invitation while retaining the MSP, siblings and reservation tombstone', async () => {
      const f = await fixture(), sibling = await fixture();
      const invitation = await f.customer.table('user_invitations').first(), siblingTenant = await sibling.customer.table('tenants').first();
      await f.cancel();
      await expect(bootstrapCoManagedWorkspace(f.db, f.operation.tenant, f.operation.operation_id, log)).rejects.toMatchObject({ code: 'OPERATION_CLOSED' });
      await f.cleanup();
      for (const table of ['tenants', 'boards', 'statuses', 'contacts', 'clients', 'roles', 'permissions', 'user_invitations'])
        expect(await f.customer.table(table), table).toEqual([]);
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
      } finally { await f.db.schema.dropTable(table); }
      await f.cleanup(); expect(await f.stored()).toMatchObject({ state: 'cancelled', error_code: null });
    });
    it('rejects a foreign sponsor and a missing cancellation request before deleting rows', async () => {
      const f = await fixture();
      // A sponsor with no co-managed participation is gated off before any row is read.
      expect(await cleanupCoManagedCustomer({ ...f.input, sponsorTenant: randomUUID() })).toMatchObject({ skipped: true });
      await expect(f.cleanup()).rejects.toMatchObject({ code: 'OPERATION_CLOSED' });
      expect(await f.customer.table('tenants')).toHaveLength(1); expect(await f.allocation()).toMatchObject({ state: 'reserved' });
    });
    it('an accepted relationship cannot be cancelled through provisioning cleanup', async () => {
      const f = await fixture();
      await f.customer.table('co_management_relationships').update({ state: 'active', accepted_at: new Date(), accepted_by: randomUUID() });
      await expect(f.cancel()).rejects.toMatchObject({ code: 'RELATIONSHIP_ACTIVE' });
      expect(await f.customer.table('tenants')).toHaveLength(1); expect(await f.allocation()).toMatchObject({ state: 'reserved' });
    });
  });
}
