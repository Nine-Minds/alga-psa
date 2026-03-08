'use server';

import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db';
import { getMicrosoftProfileReadiness } from './providerReadiness';

type TeamsInstallStatus = 'not_configured' | 'install_pending' | 'active' | 'error';
export const TEAMS_PERSONAL_TAB_ENTITY_ID = 'alga-psa-personal-tab';

export type TeamsDeepLinkDestination =
  | { type: 'my_work' }
  | { type: 'ticket'; ticketId: string }
  | { type: 'project_task'; projectId: string; taskId: string }
  | { type: 'approval'; approvalId: string }
  | { type: 'time_entry'; entryId: string }
  | { type: 'contact'; contactId: string };

export type TeamsDeepLinkSurface = 'tab' | 'notification' | 'bot' | 'message_extension';

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

function buildTeamsTabWebUrl(baseUrl: string, destination: TeamsDeepLinkDestination): string {
  switch (destination.type) {
    case 'my_work':
      return `${baseUrl}/teams/tab`;
    case 'ticket':
      return `${baseUrl}/msp/tickets/${destination.ticketId}`;
    case 'project_task':
      return `${baseUrl}/msp/projects/${destination.projectId}?taskId=${encodeURIComponent(destination.taskId)}`;
    case 'approval':
      return `${baseUrl}/msp/approvals/${destination.approvalId}`;
    case 'time_entry':
      return `${baseUrl}/msp/time?entryId=${encodeURIComponent(destination.entryId)}`;
    case 'contact':
      return `${baseUrl}/msp/contacts/${destination.contactId}`;
    default: {
      const exhaustive: never = destination;
      throw new Error(`Unsupported Teams deep-link destination: ${(exhaustive as any).type}`);
    }
  }
}

function buildTeamsTabContext(
  destination: TeamsDeepLinkDestination,
  surface: TeamsDeepLinkSurface = 'tab'
): Record<string, string> {
  switch (destination.type) {
    case 'my_work':
      return surface === 'tab' ? { page: 'my_work' } : { page: 'my_work', source: surface };
    case 'ticket':
      return surface === 'tab'
        ? { page: 'ticket', ticketId: destination.ticketId }
        : { page: 'ticket', ticketId: destination.ticketId, source: surface };
    case 'project_task':
      return surface === 'tab'
        ? { page: 'project_task', projectId: destination.projectId, taskId: destination.taskId }
        : { page: 'project_task', projectId: destination.projectId, taskId: destination.taskId, source: surface };
    case 'approval':
      return surface === 'tab'
        ? { page: 'approval', approvalId: destination.approvalId }
        : { page: 'approval', approvalId: destination.approvalId, source: surface };
    case 'time_entry':
      return surface === 'tab'
        ? { page: 'time_entry', entryId: destination.entryId }
        : { page: 'time_entry', entryId: destination.entryId, source: surface };
    case 'contact':
      return surface === 'tab'
        ? { page: 'contact', contactId: destination.contactId }
        : { page: 'contact', contactId: destination.contactId, source: surface };
    default: {
      const exhaustive: never = destination;
      throw new Error(`Unsupported Teams deep-link destination: ${(exhaustive as any).type}`);
    }
  }
}

function resolveTeamsDeepLinkDestinationFromPsaUrl(psaUrl: string): TeamsDeepLinkDestination {
  let parsed: URL;
  try {
    parsed = new URL(psaUrl, 'https://teams.alga.invalid');
  } catch {
    return { type: 'my_work' };
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] !== 'msp') {
    return { type: 'my_work' };
  }

  if (segments[1] === 'tickets' && segments[2]) {
    return { type: 'ticket', ticketId: segments[2] };
  }

  if (segments[1] === 'projects' && segments[2]) {
    const taskId = parsed.searchParams.get('taskId')?.trim();
    return taskId ? { type: 'project_task', projectId: segments[2], taskId } : { type: 'my_work' };
  }

  if (segments[1] === 'time-sheet-approvals') {
    const approvalId = parsed.searchParams.get('approvalId')?.trim();
    return approvalId ? { type: 'approval', approvalId } : { type: 'my_work' };
  }

  if (segments[1] === 'time-entry' || segments[1] === 'time') {
    const entryId = parsed.searchParams.get('entryId')?.trim();
    return entryId ? { type: 'time_entry', entryId } : { type: 'my_work' };
  }

  if (segments[1] === 'contacts' && segments[2]) {
    return { type: 'contact', contactId: segments[2] };
  }

  return { type: 'my_work' };
}

function buildTeamsPersonalTabDeepLinkForSurface(
  baseUrl: string,
  appId: string,
  destination: TeamsDeepLinkDestination,
  surface: TeamsDeepLinkSurface
): string {
  const params = new URLSearchParams({
    webUrl: buildTeamsTabWebUrl(baseUrl, destination),
    context: JSON.stringify(buildTeamsTabContext(destination, surface)),
  });
  return `https://teams.microsoft.com/l/entity/${encodeURIComponent(appId)}/${encodeURIComponent(TEAMS_PERSONAL_TAB_ENTITY_ID)}?${params.toString()}`;
}

export function buildTeamsPersonalTabDeepLink(baseUrl: string, appId: string, destination: TeamsDeepLinkDestination): string {
  return buildTeamsPersonalTabDeepLinkForSurface(baseUrl, appId, destination, 'tab');
}

export function buildTeamsPersonalTabDeepLinkFromPsaUrl(baseUrl: string, appId: string, psaUrl: string): string {
  return buildTeamsPersonalTabDeepLink(baseUrl, appId, resolveTeamsDeepLinkDestinationFromPsaUrl(psaUrl));
}

export function buildTeamsBotResultDeepLinkFromPsaUrl(baseUrl: string, appId: string, psaUrl: string): string {
  return buildTeamsPersonalTabDeepLinkForSurface(baseUrl, appId, resolveTeamsDeepLinkDestinationFromPsaUrl(psaUrl), 'bot');
}

export function buildTeamsMessageExtensionResultDeepLinkFromPsaUrl(
  baseUrl: string,
  appId: string,
  psaUrl: string
): string {
  return buildTeamsPersonalTabDeepLinkForSurface(
    baseUrl,
    appId,
    resolveTeamsDeepLinkDestinationFromPsaUrl(psaUrl),
    'message_extension'
  );
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

export const getTeamsAppPackageStatus = withAuth(async (
  user,
  { tenant }
): Promise<TeamsAppPackageStatusResponse> => {
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
        package_metadata: packageMetadata,
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
});
