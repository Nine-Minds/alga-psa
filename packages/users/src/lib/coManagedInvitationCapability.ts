import type { Knex } from 'knex';
import { isCapabilityServed } from '@alga-psa/core/capability';
import { sharedWorkSeam, type SharedWorkSeam } from '@alga-psa/shared/utils/sharedWorkSeam';

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

/**
 * Seat invitation acceptance, served by the seat shape through a shared-work seam: `@alga-psa/co-managed`
 * registers the provider by name at boot (`seatInvitationRegistration`), so this package never imports it.
 * The seam is gated on `co-managed-seat`; an unregistered or unserved seam answers `{ handled: false }`.
 * A refusal crosses the seam as data (the seat command's error code and message), never as a class.
 */
export const CO_MANAGED_SEAT_INVITATION_SEAM = 'coManagedSeatInvitation';

export type SeatInvitationAcceptance =
  | { handled: true; accepted: { user_id: string; created: boolean } }
  | { handled: true; refused: { code: string; message: string } };

export interface SeatInvitationAcceptor {
  acceptSeatInvitation(knex: Knex, input: { token: string; password: string }): Promise<SeatInvitationAcceptance>;
}

export function seatInvitationAcceptance(): SharedWorkSeam<SeatInvitationAcceptor> {
  return sharedWorkSeam<SeatInvitationAcceptor>(CO_MANAGED_SEAT_INVITATION_SEAM, 'co-managed-seat');
}
