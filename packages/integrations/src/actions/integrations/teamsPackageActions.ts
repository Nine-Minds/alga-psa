'use server';

import { withAuth } from '@alga-psa/auth/withAuth';
import { getTeamsAvailability } from '../../lib/teamsAvailability';

type TeamsInstallStatus = 'not_configured' | 'install_pending' | 'active' | 'error';

interface TeamsAppManifest {
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

let eeTeamsPackageActionsPromise:
  | Promise<{
      getTeamsAppPackageStatusImpl?: (
        user: unknown,
        ctx: { tenant: string }
      ) => Promise<TeamsAppPackageStatusResponse>;
    }>
  | null = null;

async function loadEeTeamsPackageActions() {
  if (!eeTeamsPackageActionsPromise) {
    eeTeamsPackageActionsPromise = import('../../../../../ee/server/src/lib/actions/integrations/teamsPackageActions');
  }

  return eeTeamsPackageActionsPromise;
}

export const getTeamsAppPackageStatus = withAuth(async (
  user,
  { tenant }
): Promise<TeamsAppPackageStatusResponse> => {
  const availability = await getTeamsAvailability({
    tenantId: tenant,
    userId: (user as any)?.user_id,
  });
  if (!availability.enabled) {
    return { success: false, error: availability.message };
  }

  const ee = await loadEeTeamsPackageActions();
  if (!ee?.getTeamsAppPackageStatusImpl) {
    return { success: false, error: 'Failed to load Teams app package actions' };
  }

  return ee.getTeamsAppPackageStatusImpl(user, { tenant });
});
