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

export const buildEntraConnectionOptions = (_isCippEnabled: boolean): EntraConnectionOption[] => {
  // CIPP entry point intentionally disabled in the UI. Server plumbing and the
  // CIPP_CONNECTION_OPTION constant are retained so the path can be reinstated
  // without a schema or API change.
  return [DIRECT_CONNECTION_OPTION];
};

export const shouldShowFieldSyncControls = (isFieldSyncEnabled: boolean): boolean => isFieldSyncEnabled;

export const shouldShowAmbiguousQueue = (isAmbiguousQueueEnabled: boolean): boolean => isAmbiguousQueueEnabled;
