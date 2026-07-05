import { Knex } from 'knex';

/**
 * Location-scoped write enforcement (basic per-warehouse scoping; full per-warehouse
 * RBAC is deferred). A van assigned to a specific technician may only be written by
 * that technician or the location's manager. Warehouses/offices (no assigned tech)
 * are writable by anyone who already passed the inventory permission check.
 *
 * Call from write/adjust/transfer flows after the resource permission check.
 */
export async function assertLocationWritable(
  trx: Knex.Transaction,
  tenant: string,
  userId: string | null | undefined,
  locationId: string | null | undefined,
): Promise<void> {
  if (!locationId) return;
  const loc = await trx('stock_locations')
    .where({ tenant, location_id: locationId })
    .select('assigned_user_id', 'manager_user_id')
    .first();
  if (!loc) return;
  if (loc.assigned_user_id && loc.assigned_user_id !== userId && loc.manager_user_id !== userId) {
    throw new Error("Permission denied: this location is a technician's van assigned to someone else");
  }
}
