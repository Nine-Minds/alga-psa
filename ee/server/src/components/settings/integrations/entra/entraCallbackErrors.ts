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
      return 'integrations.entra.settings.connection.callbackErrors.tokenRejected';
    // Not a permission problem — those arrive as consent_missing. The remaining
    // probe failures are almost always a partner tenant without Lighthouse/GDAP,
    // and the message must not send the operator to the permissions screen.
    case 'validation_failed':
      return 'integrations.entra.settings.connection.callbackErrors.validationFailed';
    // Microsoft rejections (AADSTS codes) mapped by the callback route.
    case 'aadsts_50194_single_tenant':
      return 'integrations.entra.settings.connection.callbackErrors.singleTenantApp';
    case 'aadsts_700016_app_not_found':
      return 'integrations.entra.settings.connection.callbackErrors.appNotInDirectory';
    case 'aadsts_50020_wrong_directory':
      return 'integrations.entra.settings.connection.callbackErrors.wrongDirectory';
    case 'aadsts_50011_redirect_uri':
      return 'integrations.entra.settings.connection.callbackErrors.redirectUriMismatch';
    case 'aadsts_7000215_invalid_secret':
      return 'integrations.entra.settings.connection.callbackErrors.invalidClientSecret';
    case 'aadsts_7000222_expired_secret':
      return 'integrations.entra.settings.connection.callbackErrors.expiredClientSecret';
    case 'expired_state':
    case 'session_expired':
      return 'integrations.entra.settings.connection.callbackErrors.expired';
    default:
      return 'integrations.entra.settings.connection.callbackErrors.generic';
  }
};
