/**
 * The Direct OAuth callback validates against Graph before it persists
 * anything, so a rejected connection redirects back with `entra_status=failure`
 * having written nothing. Without this the operator would consent at Microsoft,
 * land back on an unchanged screen, and be told nothing — the same silent
 * failure shape the Reconnect no-op had. Codes come from the callback route.
 */
export const buildEntraCallbackErrorKey = (errorCode: string | null | undefined): string => {
  switch (errorCode) {
    case 'consent_missing':
      return 'integrations.entra.settings.connection.callbackErrors.consentMissing';
    case 'auth_rejected':
    case 'validation_failed':
      return 'integrations.entra.settings.connection.callbackErrors.validationFailed';
    case 'expired_state':
    case 'session_expired':
      return 'integrations.entra.settings.connection.callbackErrors.expired';
    default:
      return 'integrations.entra.settings.connection.callbackErrors.generic';
  }
};
