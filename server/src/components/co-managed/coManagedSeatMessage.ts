type Translate = (key: string, options?: { defaultValue: string }) => string;

/**
 * The words for a refusal the seat commands name: the eligibility blockers the chooser shows before
 * a submit and the reasons a command gives after one. Only acknowledged codes become reasons.
 */
export function coManagedSeatMessage(code: string | null | undefined, t: Translate): string {
  switch (code) {
    case 'SPONSOR_NOT_ELIGIBLE':
      return t('coManaged.seat.blocker.sponsorNotEligible', { defaultValue: 'This workspace has no co-managed pool. Add co-managed seats to use this.' });
    case 'ENTITLEMENT_LAPSED':
      return t('coManaged.seat.blocker.lapsed', { defaultValue: 'The co-managed pool has lapsed. Restore it before adding seats.' });
    case 'CAPACITY_UNAVAILABLE':
      return t('coManaged.seat.blocker.capacity', { defaultValue: 'The pool has no seats left. Add seats to the pool or free some from another client.' });
    case 'CLIENT_INACTIVE':
      return t('coManaged.seat.blocker.clientInactive', { defaultValue: 'Reactivate this client before enabling co-managed IT.' });
    case 'CLIENT_NOT_FOUND':
      return t('coManaged.seat.blocker.clientNotFound', { defaultValue: 'This client is no longer available.' });
    case 'CLIENT_HAS_ARRANGEMENT':
      return t('coManaged.seat.blocker.hasArrangement', { defaultValue: 'This client already has co-managed IT. Refresh to see it.' });
    case 'OPERATION_CONFLICT':
      return t('coManaged.seat.error.operationConflict', { defaultValue: 'This request was already sent with different details. Refresh and start again.' });
    case 'INVALID_RESERVATION':
      return t('coManaged.seat.error.invalidSeats', { defaultValue: 'Enter a whole number of seats, at least 1.' });
    case 'INVALID_INVITATION':
      return t('coManaged.seat.error.invalidInvitation', { defaultValue: 'Enter a name and a valid email address.' });
    case 'EMAIL_IN_USE':
      return t('coManaged.seat.error.emailInUse', { defaultValue: 'This email already belongs to a user account. Use a different address.' });
    case 'EMAIL_INVITED':
      return t('coManaged.seat.error.emailInvited', { defaultValue: 'This email already has a pending invitation.' });
    case 'SEAT_LIMIT':
    case 'CO_MANAGED_SEAT_LIMIT':
      return t('coManaged.seat.error.seatLimit', { defaultValue: 'Every seat is in use. Add seats, or withdraw an invitation, first.' });
    case 'CO_MANAGED_POOL_LIMIT':
      return t('coManaged.seat.error.poolLimit', { defaultValue: 'The pool does not have that many seats available.' });
    case 'CO_MANAGED_LICENSE_LAPSED':
      return t('coManaged.seat.blocker.lapsed', { defaultValue: 'The co-managed pool has lapsed. Restore it before adding seats.' });
    case 'CO_MANAGED_ALLOCATION_CONFLICT':
      return t('coManaged.seat.error.allocationConflict', { defaultValue: 'The seats changed while you were editing. Refresh and try again.' });
    case 'INVALID_BOARD_SCOPE':
    case 'BOARD_NOT_FOUND':
      return t('coManaged.seat.error.board', { defaultValue: 'A selected board is no longer available. Refresh and choose again.' });
    case 'INVALID_PROJECT_GRANTS':
    case 'PROJECT_NOT_FOUND':
      return t('coManaged.seat.error.project', { defaultValue: 'A selected project is no longer available. Refresh and choose again.' });
    case 'INVALID_HANDOFF_DEFAULTS':
    case 'USER_NOT_FOUND':
      return t('coManaged.seat.error.handoffUser', { defaultValue: 'The selected person is no longer available. Choose someone else.' });
    case 'ASSIGNMENT_NOT_PENDING':
      return t('coManaged.seat.error.notPending', { defaultValue: 'This technician already accepted, so the invitation cannot be changed.' });
    case 'ARRANGEMENT_ENDED':
    case 'ARRANGEMENT_NOT_FOUND':
      return t('coManaged.seat.error.arrangementGone', { defaultValue: 'This seat arrangement is no longer active. Refresh to see its state.' });
    default:
      return t('coManaged.seat.error.generic', { defaultValue: 'That did not work. Refresh and try again.' });
  }
}
