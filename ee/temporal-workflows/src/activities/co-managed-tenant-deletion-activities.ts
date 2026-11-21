import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';

// Lives in a co-managed-*.ts file: that path is the carve-out in noCoManagedNativeImports.contract.test.ts,
// which keeps native tenant-deletion code free of co-managed coupling.

/**
 * A co-managed sponsor's customers must not outlive it pointing at a tenant that no longer
 * exists. Before the sponsor's data is deleted, accepted relationships it sponsored end (seats
 * released, customers keep their workspaces). Guarded by `hasTable`: a deployment where the
 * co-managed schema was never created has nothing to end and must not fail deletion closed
 * (DO-NOT-PORT #22). An unaccepted setup is not silently skipped: it needs the provisioning
 * cleanup helper, so the activity FAILS explicitly and the workflow stops before deleting data
 * (a new deletion failure mode, only reachable for a sponsor that still has an unaccepted setup).
 * When the tenant being deleted is a co-managed CUSTOMER, the sponsor's seat for it is released
 * first (idempotently, same path as a departure) so the sponsor's pool does not leak.
 */
export async function endTenantCoManagedSponsorships(tenantId: string): Promise<{ terminated: number; unaccepted: number; releasedSeats: number }> {
  const adminKnex = await getAdminConnection();
  // One schema probe and nothing else when there is no co-managed schema: no throw, no further query.
  if (!(await adminKnex.schema.hasTable('co_management_relationships'))) {
    return { terminated: 0, unaccepted: 0, releasedSeats: 0 };
  }
  const { endCoManagedSponsorshipsForDeletion, releaseCoManagedSeatsForCustomerDeletion } = await import('@alga-psa/co-managed');
  // Customer side first: it never fails deletion, and it returns the sponsor's seat for a workspace that is going away.
  // The sponsor's allocation lives in the sponsor's partition, so deleting the customer's own rows would leak it.
  const hasSeatLedger = await adminKnex.schema.hasTable('co_managed_allocations') && await adminKnex.schema.hasTable('co_managed_entitlements');
  const customer = hasSeatLedger ? await releaseCoManagedSeatsForCustomerDeletion(adminKnex, tenantId) : { released: 0, relationships: 0 };
  const result = await endCoManagedSponsorshipsForDeletion(adminKnex, tenantId);
  Context.current().log.info('Ended co-managed relationships before tenant deletion', { tenantId, ...result, customerRelationships: customer.relationships, releasedSeats: customer.released });
  if (result.unaccepted > 0) {
    throw new Error(`CLEANUP_INCOMPLETE: ${result.unaccepted} co-managed setup(s) were never accepted and must be cancelled first`);
  }
  return { ...result, releasedSeats: customer.released };
}
