type Translate = (key: string, options?: { defaultValue: string }) => string;

/** Only acknowledged domain codes become user-facing reasons. */
export function provisioningRejectionMessage(code: string, t: Translate): string {
  switch (code) {
    case 'CAPACITY_UNAVAILABLE':
      return t('coManaged.provisioning.capacityUnavailable', { defaultValue: 'There are not enough available co-managed seats, or the capacity is not currently verified. Refresh the seat pool and add capacity before trying again.' });
    case 'SPONSOR_NOT_ELIGIBLE':
      return t('coManaged.provisioning.ineligible', { defaultValue: 'An active Pro license and verified co-managed capacity are required to create a workspace.' });
    case 'OPERATION_CONFLICT':
      return t('coManaged.provisioning.operationConflict', { defaultValue: 'This setup request was already submitted with different details. Refresh the workspace list before starting again.' });
    case 'DESTINATION_NOT_FOUND':
      return t('coManaged.provisioning.destinationUnavailable', { defaultValue: 'The selected escalation board is no longer available. Select an active board and try again.' });
    case 'CLIENT_NOT_FOUND':
      return t('coManaged.provisioning.clientUnavailable', { defaultValue: 'This client is no longer available. Refresh the client list.' });
    case 'SETUP_CANCELLING':
      return t('coManaged.provisioning.setupCancelling', { defaultValue: 'The previous setup for this client is still being cancelled. Try again once cleanup finishes.' });
    case 'ADMINISTRATOR_EMAIL_IN_USE':
      return t('coManaged.provisioning.administratorEmailInUse', { defaultValue: 'This administrator email already belongs to a user in another workspace. Use a different email address.' });
    case 'INVALID_REQUEST':
    case 'INVALID_RESERVATION':
      return t('coManaged.provisioning.invalidRequest', { defaultValue: 'Enter a workspace name, administrator details, an escalation board, and at least one technician seat.' });
    default:
      return t('coManaged.provisioning.rejected');
  }
}

/** Why a seat allocation change was refused, for the MSP changing it. */
export function seatChangeRejectionMessage(code: string, t: Translate): string {
  switch (code) {
    case 'CO_MANAGED_SEAT_LIMIT':
      return t('coManaged.provisioning.resizeBelowUsed', { defaultValue: 'This workspace already has more technicians and pending invitations than that. Remove or deactivate some before lowering its allocation.' });
    case 'CO_MANAGED_POOL_LIMIT':
      return t('coManaged.provisioning.resizePoolLimit', { defaultValue: 'Your pool does not have enough available seats for this increase. Add seats to the pool first.' });
    case 'CO_MANAGED_LICENSE_LAPSED':
      return t('coManaged.provisioning.resizeLicenseLapsed', { defaultValue: 'Restore your Pro license and co-managed seats before increasing this allocation.' });
    default:
      return t('coManaged.provisioning.resizeError', { defaultValue: 'Could not change the allocation. Refresh and try again.' });
  }
}
