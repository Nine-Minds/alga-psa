import { isCapabilityServed } from '@alga-psa/core/capability';

/** The tenant is established by the session or verified invitation token. */
export function isCoManagedInvitationServed(tenant: string): Promise<boolean> {
  return isCapabilityServed('co-managed', tenant);
}

/**
 * A seat invitation is accepted while its sponsor is served by `co-managed-seat`: the invitation was
 * sent under admission, so acceptance keeps the participation the arrangement row gives, and closes
 * with the capability (kill switch, flag, no arrangement). Same tenant provenance as above.
 */
export function isCoManagedSeatInvitationServed(tenant: string): Promise<boolean> {
  return isCapabilityServed('co-managed-seat', tenant);
}

/** The metadata `inviteCoManagedSeatTechnician` stamps on a seat invitation, and nothing else sets. */
export function seatAssignmentOfInvitation(metadata: unknown): string | null {
  const id = (metadata as { co_managed_seat_assignment_id?: unknown } | null | undefined)?.co_managed_seat_assignment_id;
  return typeof id === 'string' && id ? id : null;
}
