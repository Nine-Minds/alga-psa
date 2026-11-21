/**
 * Registers seat invitation acceptance on the `coManagedSeatInvitation` shared-work seam, by NAME, so
 * `@alga-psa/users` (whose team setup flow receives the seat token) never imports this package.
 *
 * Registration is a side effect of importing this module, which `./capability` does, so every host that
 * registers the co-managed capabilities installs it. The factory loads `./seatInvitation` only when a
 * seat token first arrives for a tenant `co-managed-seat` serves; importing this module loads nothing.
 *
 * A seat refusal crosses the seam as data (`{ code, message }`); any other failure propagates.
 */
import type { Knex } from 'knex';
import { sharedWorkSeam } from '@alga-psa/shared/utils/sharedWorkSeam';

export const CO_MANAGED_SEAT_INVITATION_SEAM = 'coManagedSeatInvitation';

async function seatInvitationAcceptor() {
  const { acceptCoManagedSeatInvitation, CoManagedSeatInvitationError } = await import('./seatInvitation');
  return {
    async acceptSeatInvitation(knex: Knex, input: { token: string; password: string }) {
      try {
        const accepted = await acceptCoManagedSeatInvitation(knex, input);
        return { handled: true as const, accepted: { user_id: accepted.user_id, created: accepted.created } };
      } catch (error) {
        if (error instanceof CoManagedSeatInvitationError) {
          return { handled: true as const, refused: { code: error.code, message: error.message } };
        }
        throw error;
      }
    },
  };
}

/** Idempotent: a seam that already has a provider is left alone (hot reload, duplicate bundles). */
export function registerCoManagedSeatInvitationAcceptance(): void {
  const seam = sharedWorkSeam<unknown>(CO_MANAGED_SEAT_INVITATION_SEAM, 'co-managed-seat');
  if (!seam.hasProvider()) seam.register(seatInvitationAcceptor);
}

registerCoManagedSeatInvitationAcceptance();
