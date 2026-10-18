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
    case 'INVALID_REQUEST':
    case 'INVALID_RESERVATION':
      return t('coManaged.provisioning.invalidRequest', { defaultValue: 'Enter a workspace name, administrator details, an escalation board, and at least one technician seat.' });
    default:
      return t('coManaged.provisioning.rejected');
  }
}
