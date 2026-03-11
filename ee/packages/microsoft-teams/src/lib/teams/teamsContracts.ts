import type {
  TeamsAllowedAction,
  TeamsCapability,
  TeamsInstallStatus,
  TeamsNotificationCategory,
} from './teamsShared';

export interface TeamsIntegrationStatusResponse {
  success: boolean;
  error?: string;
  integration?: {
    selectedProfileId: string | null;
    installStatus: TeamsInstallStatus;
    enabledCapabilities: TeamsCapability[];
    notificationCategories: TeamsNotificationCategory[];
    allowedActions: TeamsAllowedAction[];
    appId: string | null;
    botId: string | null;
    packageMetadata: Record<string, unknown> | null;
    lastError: string | null;
  };
}

export interface TeamsIntegrationExecutionState {
  selectedProfileId: string | null;
  installStatus: TeamsInstallStatus;
  enabledCapabilities: TeamsCapability[];
  allowedActions: TeamsAllowedAction[];
  appId: string | null;
  packageMetadata: Record<string, unknown> | null;
}

export interface TeamsIntegrationSettingsInput {
  selectedProfileId?: string | null;
  installStatus?: TeamsInstallStatus;
  enabledCapabilities?: TeamsCapability[];
  notificationCategories?: TeamsNotificationCategory[];
  allowedActions?: TeamsAllowedAction[];
  lastError?: string | null;
}

export interface TeamsAppManifest {
  $schema: string;
  manifestVersion: string;
  version: string;
  id: string;
  packageName: string;
  developer: {
    name: string;
    websiteUrl: string;
    privacyUrl: string;
    termsOfUseUrl: string;
  };
  name: {
    short: string;
    full: string;
  };
  description: {
    short: string;
    full: string;
  };
  icons: {
    outline: string;
    color: string;
  };
  accentColor: string;
  staticTabs: Array<{
    entityId: string;
    name: string;
    contentUrl: string;
    websiteUrl: string;
    searchUrl: string;
    scopes: string[];
  }>;
  bots: Array<{
    botId: string;
    scopes: string[];
    supportsFiles: boolean;
    isNotificationOnly: boolean;
    commandLists: Array<{
      scopes: string[];
      commands: Array<{
        title: string;
        description: string;
      }>;
    }>;
  }>;
  composeExtensions: Array<{
    botId: string;
    commands: Array<{
      id: string;
      type: 'query' | 'action';
      title: string;
      description: string;
      contexts: string[];
      parameters?: Array<{
        name: string;
        title: string;
        description: string;
        inputType: string;
      }>;
      fetchTask?: boolean;
    }>;
  }>;
  activities: {
    activityTypes: Array<{
      type: string;
      description: string;
      templateText: string;
    }>;
  };
  authorization?: {
    permissions: {
      resourceSpecific: Array<{
        type: 'Application' | 'Delegated';
        name: string;
      }>;
    };
  };
  permissions: string[];
  validDomains: string[];
  webApplicationInfo: {
    id: string;
    resource: string;
  };
}

export interface TeamsAppPackageStatusResponse {
  success: boolean;
  error?: string;
  package?: {
    installStatus: TeamsInstallStatus;
    selectedProfileId: string;
    appId: string;
    botId: string;
    manifestVersion: string;
    packageVersion: string;
    fileName: string;
    baseUrl: string;
    validDomains: string[];
    webApplicationInfo: {
      id: string;
      resource: string;
    };
    deepLinks: {
      myWork: string;
      ticketTemplate: string;
      projectTaskTemplate: string;
      approvalTemplate: string;
      timeEntryTemplate: string;
      contactTemplate: string;
    };
    manifest: TeamsAppManifest;
  };
}
