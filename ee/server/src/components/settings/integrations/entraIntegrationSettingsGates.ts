export interface EntraConnectionOption {
  id: 'direct' | 'cipp';
  title: string;
  description: string;
}

const DIRECT_CONNECTION_OPTION: EntraConnectionOption = {
  id: 'direct',
  title: 'Direct Microsoft Partner',
  description: 'Use Microsoft delegated partner access with the configured OAuth app credentials.',
};

const CIPP_CONNECTION_OPTION: EntraConnectionOption = {
  id: 'cipp',
  title: 'CIPP',
  description: 'Use a CIPP endpoint/token as the Entra data source for discovery and sync.',
};

export const buildEntraConnectionOptions = (isCippEnabled: boolean): EntraConnectionOption[] => {
  // The caller combines the entra-integration-cipp flag with TIER_FEATURES.CIPP.
  return isCippEnabled
    ? [DIRECT_CONNECTION_OPTION, CIPP_CONNECTION_OPTION]
    : [DIRECT_CONNECTION_OPTION];
};

export interface EntraStatusHeaderAction {
  disconnect: boolean;
  /** When set, the connection type Reconnect must re-run — never a guess. */
  reconnect: 'direct' | 'cipp' | null;
}

/**
 * The action offered beside the status badge. A never-connected tenant gets
 * none: the connection chooser below is the first-run action, and a Reconnect
 * button there silently committed CIPP shops to Direct OAuth.
 */
export const buildEntraStatusHeaderAction = (params: {
  status: string | null | undefined;
  connectionType: 'direct' | 'cipp' | null | undefined;
}): EntraStatusHeaderAction => {
  if (params.status === 'connected') {
    return { disconnect: true, reconnect: null };
  }

  return {
    disconnect: false,
    reconnect: params.connectionType || null,
  };
};

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

/**
 * Field-sync rules and the review queue used to hide behind default-off flags,
 * which is why the two most reassuring parts of the feature were invisible to
 * the people who needed them. Both surfaces are permanent now; these remain so
 * call sites read as decisions rather than bare `true`.
 */
export const shouldShowFieldSyncControls = (): boolean => true;

export const shouldShowAmbiguousQueue = (): boolean => true;
