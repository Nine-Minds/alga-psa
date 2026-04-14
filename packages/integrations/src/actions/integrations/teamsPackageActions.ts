'use server';

import { hasPermission } from '@alga-psa/auth/rbac';
import { withAuth } from '@alga-psa/auth/withAuth';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db';
import { getTeamsAvailability } from '../../lib/teamsAvailability';
import { getMicrosoftProfileReadiness } from './providerReadiness';
import type { TeamsAppPackageStatusResponse } from './teamsContracts';
import type { TeamsInstallStatus } from './teamsShared';
import {
  buildTeamsPersonalTabDeepLink,
  TEAMS_PERSONAL_TAB_ENTITY_ID,
} from './teamsDeepLinks';

interface TeamsIntegrationRow {
  tenant: string;
  selected_profile_id: string | null;
  install_status: TeamsInstallStatus;
  app_id?: string | null;
  bot_id?: string | null;
  package_metadata?: unknown;
  updated_by?: string | null;
  updated_at?: string | Date;
}

interface MicrosoftProfileRow {
  tenant: string;
  profile_id: string;
  display_name: string;
  client_id: string;
  tenant_id: string;
  client_secret_ref: string;
  is_archived: boolean;
}

interface TeamsAppManifest {
  $schema: string;
  manifestVersion: string;
  version: string;
  id: string;
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
      context: string[];
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

interface PersistedTeamsPackageMetadata {
  manifestVersion: string;
  packageVersion: string;
  fileName: string;
  baseUrl: string;
  validDomains: string[];
  webApplicationInfo: {
    id: string;
    resource: string;
  };
}

const TEAMS_MANIFEST_VERSION = '1.24';
const TEAMS_PACKAGE_VERSION = '1.0.0';

function isClientPortalUser(user: any): boolean {
  return user?.user_type === 'client';
}

async function canManageTeamsSettings(user: any): Promise<boolean> {
  return hasPermission(user as any, 'system_settings', 'update');
}

function computeBaseUrl(envValue?: string | null): string {
  const raw = (envValue || '').trim();
  if (!raw) return 'http://localhost:3000';

  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return 'http://localhost:3000';
  }
}

async function getDeploymentBaseUrl(): Promise<string> {
  const secretProvider = await getSecretProviderInstance();
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await secretProvider.getAppSecret('NEXTAUTH_URL')) ||
    'http://localhost:3000';

  return computeBaseUrl(base);
}

function getTeamsApplicationIdUri(baseUrl: string, clientId: string): string {
  const url = new URL(baseUrl);
  return `api://${url.host}/teams/${clientId}`;
}

function buildTeamsAppManifest(baseUrl: string, tenant: string, profile: MicrosoftProfileRow): TeamsAppManifest {
  const host = new URL(baseUrl).host;
  const appIdUri = getTeamsApplicationIdUri(baseUrl, profile.client_id);

  return {
    $schema: `https://developer.microsoft.com/json-schemas/teams/v${TEAMS_MANIFEST_VERSION}/MicrosoftTeams.schema.json`,
    manifestVersion: TEAMS_MANIFEST_VERSION,
    version: TEAMS_PACKAGE_VERSION,
    id: profile.client_id,
    developer: {
      name: 'Alga PSA',
      websiteUrl: baseUrl,
      privacyUrl: `${baseUrl}/privacy`,
      termsOfUseUrl: `${baseUrl}/terms`,
    },
    name: {
      short: 'Alga PSA',
      full: 'Alga PSA for Microsoft Teams',
    },
    description: {
      short: 'Manage PSA tickets, time, notes, and approvals from Microsoft Teams.',
      full:
        'Alga PSA for Microsoft Teams gives MSP technicians a personal tab, personal-scope bot, message extension, and activity feed notifications backed by the tenant-selected Microsoft profile.',
    },
    icons: {
      outline: 'outline.png',
      color: 'color.png',
    },
    accentColor: '#0F766E',
    staticTabs: [
      {
        entityId: TEAMS_PERSONAL_TAB_ENTITY_ID,
        name: 'Alga PSA',
        contentUrl: `${baseUrl}/teams/tab`,
        websiteUrl: `${baseUrl}/teams/tab`,
        searchUrl: `${baseUrl}/teams/search`,
        scopes: ['personal'],
      },
    ],
    bots: [
      {
        botId: profile.client_id,
        scopes: ['personal'],
        supportsFiles: false,
        isNotificationOnly: false,
        commandLists: [
          {
            scopes: ['personal'],
            commands: [
              { title: 'my work', description: 'Open your Alga PSA work list in Teams.' },
              { title: 'ticket search', description: 'Search Alga PSA tickets from Teams.' },
            ],
          },
        ],
      },
    ],
    composeExtensions: [
      {
        botId: profile.client_id,
        commands: [
          {
            id: 'searchTickets',
            type: 'query',
            title: 'Search tickets',
            description: 'Find tickets and work items from Alga PSA',
            context: ['compose', 'commandBox'],
            parameters: [
              {
                name: 'query',
                title: 'Search',
                description: 'Ticket number, requester, or summary',
                inputType: 'text',
              },
            ],
          },
        ],
      },
    ],
    activities: {
      activityTypes: [
        {
          type: 'ticketAssigned',
          description: 'Ticket assigned',
          templateText: '{actor} assigned ticket {ticketNumber} to you.',
        },
      ],
    },
    authorization: {
      permissions: {
        resourceSpecific: [
          { type: 'Application', name: 'ChannelMessage.Read.Group' },
        ],
      },
    },
    permissions: ['identity', 'messageTeamMembers'],
    validDomains: [host],
    webApplicationInfo: {
      id: profile.client_id,
      resource: appIdUri,
    },
  };
}

function buildPersistedPackageMetadata(baseUrl: string, manifest: TeamsAppManifest): PersistedTeamsPackageMetadata {
  return {
    manifestVersion: manifest.manifestVersion,
    packageVersion: manifest.version,
    fileName: `alga-psa-teams-${manifest.version}.zip`,
    baseUrl,
    validDomains: manifest.validDomains,
    webApplicationInfo: manifest.webApplicationInfo,
  };
}

async function getTeamsIntegrationRow(knex: any, tenant: string): Promise<TeamsIntegrationRow | undefined> {
  const row = await knex('teams_integrations').where({ tenant }).first();
  return row || undefined;
}

async function getMicrosoftProfileRow(
  knex: any,
  tenant: string,
  profileId: string
): Promise<MicrosoftProfileRow | undefined> {
  const row = await knex('microsoft_profiles').where({ tenant, profile_id: profileId }).first();
  return row || undefined;
}

function parsePersistedPackageMetadata(
  value: unknown
): PersistedTeamsPackageMetadata | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as PersistedTeamsPackageMetadata;
  if (
    !candidate.fileName ||
    !candidate.baseUrl ||
    !candidate.manifestVersion ||
    !candidate.packageVersion ||
    !candidate.webApplicationInfo?.id ||
    !candidate.webApplicationInfo?.resource
  ) {
    return null;
  }

  return candidate;
}

async function getTeamsAppPackageStatusImpl(
  user: unknown,
  { tenant }: { tenant: string }
): Promise<TeamsAppPackageStatusResponse> {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
    if (!(await canManageTeamsSettings(user))) return { success: false, error: 'Forbidden' };

    const { knex } = await createTenantKnex();
    const integration = await getTeamsIntegrationRow(knex, tenant);
    if (!integration?.selected_profile_id) {
      return { success: false, error: 'Select a Microsoft profile for Teams before generating the package' };
    }

    const profile = await getMicrosoftProfileRow(knex, tenant, integration.selected_profile_id);
    if (!profile || profile.is_archived) {
      return { success: false, error: 'Selected Microsoft profile is unavailable' };
    }

    const readiness = await getMicrosoftProfileReadiness(tenant, {
      clientId: profile.client_id,
      tenantId: profile.tenant_id,
      clientSecretRef: profile.client_secret_ref,
      isArchived: profile.is_archived,
    });
    if (!readiness.ready) {
      return { success: false, error: 'Selected Microsoft profile is not ready for Teams package generation' };
    }

    const baseUrl = await getDeploymentBaseUrl();
    const manifest = buildTeamsAppManifest(baseUrl, tenant, profile);
    const packageMetadata = buildPersistedPackageMetadata(baseUrl, manifest);

    await knex('teams_integrations')
      .where({ tenant })
      .update({
        app_id: profile.client_id,
        bot_id: profile.client_id,
        package_metadata: JSON.stringify(packageMetadata),
        updated_by: (user as any)?.user_id || null,
        updated_at: new Date(),
      });

    return {
      success: true,
      package: {
        installStatus: integration.install_status,
        selectedProfileId: profile.profile_id,
        appId: profile.client_id,
        botId: profile.client_id,
        manifestVersion: packageMetadata.manifestVersion,
        packageVersion: packageMetadata.packageVersion,
        fileName: packageMetadata.fileName,
        baseUrl: packageMetadata.baseUrl,
        validDomains: packageMetadata.validDomains,
        webApplicationInfo: packageMetadata.webApplicationInfo,
        deepLinks: {
          myWork: buildTeamsPersonalTabDeepLink(baseUrl, profile.client_id, { type: 'my_work' }),
          ticketTemplate: buildTeamsPersonalTabDeepLink(baseUrl, profile.client_id, { type: 'ticket', ticketId: '{ticketId}' }),
          projectTaskTemplate: buildTeamsPersonalTabDeepLink(baseUrl, profile.client_id, {
            type: 'project_task',
            projectId: '{projectId}',
            taskId: '{taskId}',
          }),
          approvalTemplate: buildTeamsPersonalTabDeepLink(baseUrl, profile.client_id, { type: 'approval', approvalId: '{approvalId}' }),
          timeEntryTemplate: buildTeamsPersonalTabDeepLink(baseUrl, profile.client_id, { type: 'time_entry', entryId: '{entryId}' }),
          contactTemplate: buildTeamsPersonalTabDeepLink(baseUrl, profile.client_id, { type: 'contact', contactId: '{contactId}' }),
        },
        manifest,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to build Teams app package' };
  }
}

export const getTeamsAppPackageStatus = withAuth(async (
  user,
  { tenant }
): Promise<TeamsAppPackageStatusResponse> => {
  const availability = await getTeamsAvailability({
    tenantId: tenant,
    userId: (user as any)?.user_id,
  });
  if (availability.enabled === false) {
    return { success: false, error: availability.message };
  }

  return getTeamsAppPackageStatusImpl(user, { tenant });
});
