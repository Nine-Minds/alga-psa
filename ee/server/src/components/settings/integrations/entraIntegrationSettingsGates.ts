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

export const shouldShowFieldSyncControls = (isFieldSyncEnabled: boolean): boolean => isFieldSyncEnabled;

export const shouldShowAmbiguousQueue = (isAmbiguousQueueEnabled: boolean): boolean => isAmbiguousQueueEnabled;
