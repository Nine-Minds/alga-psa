import { isCapabilityServed } from '@alga-psa/core/capability';
import { coManagedSeatNotificationsServed } from './seatNotifications';

/**
 * Whether the seat shape is released for the tenant: the rollout flag (`release-v2-0-feature`) is on
 * AND the `co-managed-seat` capability is served. The one gate for every seat surface: the technician's
 * list views, the MSP list's responsibility column and filter, the ticket screen's chip and handoff, and
 * the SLA pause. The flag is checked first and is synchronous, so a tenant it is off for pays nothing.
 */
export async function coManagedSeatReleased(tenant: string): Promise<boolean> {
  return coManagedSeatNotificationsServed(tenant) && await isCapabilityServed('co-managed-seat', tenant);
}
