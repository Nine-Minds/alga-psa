import { hasPermission } from '@alga-psa/auth/rbac';
import { withAuth } from '@alga-psa/auth/withAuth';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db';
import { TIER_FEATURES } from '@alga-psa/types';
import { getMicrosoftProfileReadiness } from './providerReadiness';
import { getTeamsAvailability } from '../../teams/teamsAvailability';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import {
  buildTeamsPersonalTabDeepLink,
  TEAMS_PERSONAL_TAB_ENTITY_ID,
} from '../../teams/teamsDeepLinks';
import type { TeamsAppPackageStatusResponse } from '../../teams/teamsContracts';
import type { TeamsInstallStatus } from '../../teams/teamsShared';

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
    packageName: `com.algapsa.teams.${tenant}`,
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
      short: 'Manage PSA work from the Teams personal tab, bot, message extension, and personal notifications.',
      full: 'Alga PSA for Microsoft Teams gives MSP technicians a personal tab, personal-scope bot, message extension, and activity feed notifications backed by the tenant-selected Microsoft profile.',
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
              { title: 'my tickets', description: 'Show the technician work queue.' },
              { title: 'ticket <id>', description: 'Open a specific ticket summary.' },
              { title: 'assign ticket', description: 'Assign a ticket from Teams.' },
              { title: 'add note', description: 'Append an internal note.' },
              { title: 'reply to contact', description: 'Send a customer-facing reply.' },
              { title: 'log time', description: 'Create a time entry.' },
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
            id: 'searchRecords',
            type: 'query',
            title: 'Search PSA records',
            description: 'Find tickets, tasks, contacts, and approvals.',
            contexts: ['compose', 'commandBox'],
            parameters: [
              {
                name: 'query',
                title: 'Search query',
                description: 'Search for PSA records',
                inputType: 'text',
              },
            ],
          },
          {
            id: 'createTicketFromMessage',
            type: 'action',
            title: 'Create ticket from message',
            description: 'Create a PSA ticket from the selected Teams message.',
            contexts: ['message'],
            fetchTask: true,
          },
          {
            id: 'updateFromMessage',
            type: 'action',
            title: 'Update PSA record from message',
            description: 'Append the selected Teams message to an existing PSA record.',
            contexts: ['message'],
            fetchTask: true,
          },
        ],
      },
    ],
    activities: {
      activityTypes: [
        { type: 'assignmentCreated', description: 'Work assignment notification', templateText: '{actor} assigned {item}' },
        { type: 'customerReplyReceived', description: 'Customer reply notification', templateText: '{item} received a customer reply' },
        { type: 'approvalRequested', description: 'Approval request notification', templateText: '{actor} requested approval for {item}' },
        { type: 'workEscalated', description: 'Escalation notification', templateText: '{item} was escalated' },
        { type: 'slaRiskDetected', description: 'SLA risk notification', templateText: '{item} is at SLA risk' },
      ],
    },
    authorization: {
      permissions: {
        resourceSpecific: [
          {
            type: 'Application',
            name: 'TeamsActivity.Send.User',
          },
        ],
      },
    },
    permissions: ['identity', 'messageTeamMembers'],
    validDomains: [host, 'token.botframework.com'],
    webApplicationInfo: {
      id: profile.client_id,
      resource: appIdUri,
    },
  };
}

async function getTeamsIntegrationRow(knex: any, tenant: string): Promise<TeamsIntegrationRow | undefined> {
  const row = await knex('teams_integrations').where({ tenant }).first();
  return row || undefined;
}

async function getMicrosoftProfileRow(knex: any, tenant: string, profileId: string): Promise<MicrosoftProfileRow | undefined> {
  const row = await knex('microsoft_profiles').where({ tenant, profile_id: profileId }).first();
  return row || undefined;
}

export async function getTeamsAppPackageStatusImpl(
  user: unknown,
  { tenant }: { tenant: string }
): Promise<TeamsAppPackageStatusResponse> {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
    if (!(await canManageTeamsSettings(user))) return { success: false, error: 'Forbidden' };

    const { knex } = await createTenantKnex();
    const integration = await getTeamsIntegrationRow(knex, tenant);

    if (!integration) {
      return { success: false, error: 'Teams is not configured for this tenant' };
    }

    if (!integration.selected_profile_id) {
      return { success: false, error: 'Select a Microsoft profile before generating a Teams package' };
    }

    const profile = await getMicrosoftProfileRow(knex, tenant, integration.selected_profile_id);
    if (!profile || profile.is_archived) {
      return { success: false, error: 'Selected Microsoft profile is unavailable for Teams package generation' };
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
    const deepLinks = {
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
    };
    const fileName = `alga-psa-teams-${tenant}.zip`;
    const packageMetadata: PersistedTeamsPackageMetadata = {
      manifestVersion: TEAMS_MANIFEST_VERSION,
      packageVersion: TEAMS_PACKAGE_VERSION,
      fileName,
      baseUrl,
      validDomains: manifest.validDomains,
      webApplicationInfo: manifest.webApplicationInfo,
    };

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
        selectedProfileId: integration.selected_profile_id,
        appId: profile.client_id,
        botId: profile.client_id,
        manifestVersion: TEAMS_MANIFEST_VERSION,
        packageVersion: TEAMS_PACKAGE_VERSION,
        fileName,
        baseUrl,
        validDomains: manifest.validDomains,
        webApplicationInfo: manifest.webApplicationInfo,
        deepLinks,
        manifest,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to build Teams app package metadata' };
  }
}

export const getTeamsAppPackageStatus = withAuth(async (
  user,
  { tenant }
): Promise<TeamsAppPackageStatusResponse> => {
  await assertTierAccess(TIER_FEATURES.INTEGRATIONS);

  const availability = await getTeamsAvailability({
    tenantId: tenant,
    userId: (user as any)?.user_id,
  });
  if (availability.enabled === false) {
    return { success: false, error: availability.message };
  }

  return getTeamsAppPackageStatusImpl(user, { tenant });
});
