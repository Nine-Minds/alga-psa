'use server';

import { hasPermission } from '@alga-psa/auth/rbac';
import { withAuth } from '@alga-psa/auth/withAuth';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getTeamsAvailability, resolveTeamsAvailability } from '../../lib/teamsAvailability';
import { getMicrosoftProfileReadiness } from './providerReadiness';
import {
  TEAMS_ALLOWED_ACTIONS,
  TEAMS_CAPABILITIES,
  TEAMS_INSTALL_STATUSES,
  TEAMS_NOTIFICATION_CATEGORIES,
  type TeamsAllowedAction,
  type TeamsCapability,
  type TeamsInstallStatus,
  type TeamsNotificationCategory,
} from './teamsShared';
import type {
  TeamsIntegrationExecutionState,
  TeamsIntegrationSettingsInput,
  TeamsIntegrationStatusResponse,
} from './teamsContracts';

type EeTeamsDiagnosticsActions = typeof import('@alga-psa/ee-microsoft-teams/actions');
export type TeamsDiagnosticsReport = Awaited<ReturnType<EeTeamsDiagnosticsActions['runTeamsDiagnosticsImpl']>>;
export type TeamsTestMessageResult = Awaited<ReturnType<EeTeamsDiagnosticsActions['sendTeamsTestMessageImpl']>>;

interface TeamsIntegrationRow {
  tenant: string;
  selected_profile_id: string | null;
  install_status: TeamsInstallStatus;
  enabled_capabilities: unknown;
  notification_categories: unknown;
  allowed_actions: unknown;
  app_id?: string | null;
  bot_id?: string | null;
  package_metadata?: unknown;
  last_error: string | null;
  default_meeting_organizer_upn?: string | null;
  default_meeting_organizer_object_id?: string | null;
  download_recordings?: boolean | null;
  expose_recordings_in_portal?: boolean | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface MicrosoftProfileRow {
  tenant: string;
  profile_id: string;
  client_id: string;
  tenant_id: string;
  client_secret_ref: string;
  is_archived: boolean;
}

const DEFAULT_EXECUTION_STATE: TeamsIntegrationExecutionState = {
  selectedProfileId: null,
  installStatus: 'not_configured',
  enabledCapabilities: ['personal_tab', 'personal_bot', 'message_extension', 'activity_notifications'],
  allowedActions: ['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response'],
  appId: null,
  packageMetadata: null,
  defaultMeetingOrganizerUpn: null,
  defaultMeetingOrganizerObjectId: null,
  downloadRecordings: false,
  exposeRecordingsInPortal: false,
};

function isClientPortalUser(user: any): boolean {
  return user?.user_type === 'client';
}

async function canManageTeamsSettings(user: any): Promise<boolean> {
  return hasPermission(user as any, 'system_settings', 'update');
}

function isTeamsInstallStatus(value: string): value is TeamsInstallStatus {
  return (TEAMS_INSTALL_STATUSES as readonly string[]).includes(value);
}

function normalizeEnumArray<T extends string>(values: unknown, supported: readonly T[]): T[] {
  let normalizedValues = values;
  if (typeof normalizedValues === 'string') {
    try {
      normalizedValues = JSON.parse(normalizedValues);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(normalizedValues)) {
    return [];
  }

  const requested = new Set(
    normalizedValues.filter((value): value is T => typeof value === 'string' && supported.includes(value as T))
  );
  return supported.filter((value) => requested.has(value));
}

function toJsonbValue<T>(value: T): string {
  return JSON.stringify(value);
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function fetchMicrosoftGraphAppToken(params: {
  tenantAuthority: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(params.tenantAuthority)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to acquire Microsoft Graph app token');
  }

  const payload = await response.json() as { access_token?: unknown };
  const accessToken = normalizeNullableString(payload.access_token);
  if (!accessToken) {
    throw new Error('Microsoft Graph token response did not include an access token');
  }
  return accessToken;
}

// Capabilities that default to disabled for new tenants. `group_chat_bot`
// is opt-in because bot responses in group chats are visible to every
// member of the chat regardless of their PSA permissions — admins must
// consciously enable it.
const TEAMS_CAPABILITIES_OPT_IN: readonly TeamsCapability[] = ['group_chat_bot'];

function defaultTeamsIntegrationState() {
  return {
    selectedProfileId: null,
    installStatus: 'not_configured' as TeamsInstallStatus,
    enabledCapabilities: TEAMS_CAPABILITIES.filter(
      (capability) => !TEAMS_CAPABILITIES_OPT_IN.includes(capability)
    ) as TeamsCapability[],
    notificationCategories: [...TEAMS_NOTIFICATION_CATEGORIES] as TeamsNotificationCategory[],
    allowedActions: [...TEAMS_ALLOWED_ACTIONS] as TeamsAllowedAction[],
    appId: null as string | null,
    botId: null as string | null,
    packageMetadata: null as Record<string, unknown> | null,
    lastError: null as string | null,
    defaultMeetingOrganizerUpn: null as string | null,
    defaultMeetingOrganizerObjectId: null as string | null,
    downloadRecordings: false,
    exposeRecordingsInPortal: false,
  };
}

function mapTeamsIntegrationRow(
  row?: TeamsIntegrationRow | null
): NonNullable<TeamsIntegrationStatusResponse['integration']> {
  if (!row) {
    return defaultTeamsIntegrationState();
  }

  return {
    selectedProfileId: row.selected_profile_id || null,
    installStatus: isTeamsInstallStatus(row.install_status) ? row.install_status : 'not_configured',
    enabledCapabilities: normalizeEnumArray(row.enabled_capabilities, TEAMS_CAPABILITIES),
    notificationCategories: normalizeEnumArray(
      row.notification_categories,
      TEAMS_NOTIFICATION_CATEGORIES
    ),
    allowedActions: normalizeEnumArray(row.allowed_actions, TEAMS_ALLOWED_ACTIONS),
    appId: row.app_id || null,
    botId: row.bot_id || null,
    packageMetadata:
      row.package_metadata && typeof row.package_metadata === 'object'
        ? (row.package_metadata as Record<string, unknown>)
        : null,
    lastError: row.last_error || null,
    defaultMeetingOrganizerUpn: normalizeNullableString(row.default_meeting_organizer_upn),
    defaultMeetingOrganizerObjectId: normalizeNullableString(row.default_meeting_organizer_object_id),
    downloadRecordings: Boolean(row.download_recordings),
    exposeRecordingsInPortal: Boolean(row.expose_recordings_in_portal),
  };
}

async function getTeamsIntegrationRow(knex: any, tenant: string): Promise<TeamsIntegrationRow | undefined> {
  const row = await tenantDb(knex, tenant).table<TeamsIntegrationRow>('teams_integrations').first();
  return row || undefined;
}

async function getMicrosoftProfileRow(
  knex: any,
  tenant: string,
  profileId: string
): Promise<MicrosoftProfileRow | undefined> {
  const row = await tenantDb(knex, tenant).table<MicrosoftProfileRow>('microsoft_profiles').where({ profile_id: profileId }).first();
  return row || undefined;
}

async function resolveOrganizerObjectId(
  tenant: string,
  profile: MicrosoftProfileRow,
  organizerUpn: string
): Promise<{ objectId?: string; error?: string }> {
  const secretProvider = await getSecretProviderInstance();
  const clientSecret = profile.client_secret_ref
    ? await secretProvider.getTenantSecret(tenant, profile.client_secret_ref)
    : null;

  if (!profile.client_id || !profile.tenant_id || !clientSecret) {
    return { error: 'Selected Microsoft profile is not ready for Teams organizer lookup' };
  }

  const accessToken = await fetchMicrosoftGraphAppToken({
    tenantAuthority: profile.tenant_id,
    clientId: profile.client_id,
    clientSecret,
  });

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizerUpn)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    return {
      error: response.status === 404
        ? 'Microsoft could not find the configured meeting organizer'
        : 'Microsoft Graph could not resolve the configured meeting organizer',
    };
  }

  const payload = await response.json() as { id?: unknown };
  const objectId = normalizeNullableString(payload.id);
  return objectId
    ? { objectId }
    : { error: 'Microsoft Graph returned no object id for the configured meeting organizer' };
}

async function validateSelectedProfile(
  knex: any,
  tenant: string,
  profileId: string | null,
  requireReady: boolean
): Promise<{ profile?: MicrosoftProfileRow; error?: string }> {
  if (!profileId) {
    return requireReady
      ? { error: 'A Microsoft profile must be selected before Teams can be activated' }
      : {};
  }

  const profile = await getMicrosoftProfileRow(knex, tenant, profileId);
  if (!profile) {
    return { error: 'Selected Microsoft profile was not found' };
  }
  if (profile.is_archived) {
    return { error: 'Archived Microsoft profiles cannot be selected for Teams' };
  }

  if (requireReady) {
    const readiness = await getMicrosoftProfileReadiness(tenant, {
      clientId: profile.client_id,
      tenantId: profile.tenant_id,
      clientSecretRef: profile.client_secret_ref,
      isArchived: profile.is_archived,
    });

    if (!readiness.ready) {
      return { error: 'Selected Microsoft profile is not ready for Teams setup' };
    }
  }

  return { profile };
}

async function getTeamsIntegrationStatusImpl(
  user: unknown,
  { tenant }: { tenant: string }
): Promise<TeamsIntegrationStatusResponse> {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
    if (!(await canManageTeamsSettings(user))) return { success: false, error: 'Forbidden' };

    const availability = await getTeamsAvailability({
      tenantId: tenant,
      userId: (user as any)?.user_id,
    });
    if (availability.enabled === false) {
      return { success: false, error: availability.message };
    }

    const { knex } = await createTenantKnex();
    const row = await getTeamsIntegrationRow(knex, tenant);
    return {
      success: true,
      integration: mapTeamsIntegrationRow(row),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load Teams integration settings' };
  }
}

async function getTeamsIntegrationExecutionStateImpl(
  tenant: string
): Promise<TeamsIntegrationExecutionState> {
  const availability = await getTeamsAvailability({ tenantId: tenant });
  if (availability.enabled === false) {
    return DEFAULT_EXECUTION_STATE;
  }

  const { knex } = await createTenantKnex();
  const row = await getTeamsIntegrationRow(knex, tenant);
  const integration = mapTeamsIntegrationRow(row);

  return {
    selectedProfileId: integration.selectedProfileId,
    installStatus: integration.installStatus,
    enabledCapabilities: integration.enabledCapabilities,
    allowedActions: integration.allowedActions,
    appId: integration.appId,
    packageMetadata: integration.packageMetadata,
    defaultMeetingOrganizerUpn: integration.defaultMeetingOrganizerUpn,
    defaultMeetingOrganizerObjectId: integration.defaultMeetingOrganizerObjectId,
    downloadRecordings: integration.downloadRecordings,
    exposeRecordingsInPortal: integration.exposeRecordingsInPortal,
  };
}

async function saveTeamsIntegrationSettingsImpl(
  user: unknown,
  { tenant }: { tenant: string },
  input: TeamsIntegrationSettingsInput
): Promise<TeamsIntegrationStatusResponse> {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
    if (!(await canManageTeamsSettings(user))) return { success: false, error: 'Forbidden' };

    const availability = await getTeamsAvailability({
      tenantId: tenant,
      userId: (user as any)?.user_id,
    });
    if (availability.enabled === false) {
      return { success: false, error: availability.message };
    }

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    const existing = await getTeamsIntegrationRow(knex, tenant);
    const next = {
      ...defaultTeamsIntegrationState(),
      ...mapTeamsIntegrationRow(existing),
    };

    const selectedProfileId =
      input.selectedProfileId === undefined ? next.selectedProfileId : input.selectedProfileId;
    const requestedInstallStatus = input.installStatus ?? next.installStatus;

    if (!isTeamsInstallStatus(requestedInstallStatus)) {
      return { success: false, error: 'Unsupported Teams install status' };
    }

    const profileValidation = await validateSelectedProfile(
      knex,
      tenant,
      selectedProfileId ?? null,
      requestedInstallStatus === 'active'
    );
    if (profileValidation.error) {
      return { success: false, error: profileValidation.error };
    }

    const selectedProfileChanged =
      Boolean(existing?.selected_profile_id) &&
      existing?.selected_profile_id !== (selectedProfileId ?? null);
    const installStatus =
      selectedProfileChanged && requestedInstallStatus !== 'not_configured'
        ? 'install_pending'
        : requestedInstallStatus;

    const enabledCapabilities = input.enabledCapabilities
      ? normalizeEnumArray(input.enabledCapabilities, TEAMS_CAPABILITIES)
      : next.enabledCapabilities;
    const notificationCategories = input.notificationCategories
      ? normalizeEnumArray(input.notificationCategories, TEAMS_NOTIFICATION_CATEGORIES)
      : next.notificationCategories;
    const allowedActions = input.allowedActions
      ? normalizeEnumArray(input.allowedActions, TEAMS_ALLOWED_ACTIONS)
      : next.allowedActions;
    const lastError = selectedProfileChanged
      ? null
      : input.lastError === undefined
        ? next.lastError
        : input.lastError;
    const defaultMeetingOrganizerUpn = input.defaultMeetingOrganizerUpn === undefined
      ? next.defaultMeetingOrganizerUpn
      : normalizeNullableString(input.defaultMeetingOrganizerUpn);
    let defaultMeetingOrganizerObjectId = defaultMeetingOrganizerUpn
      ? next.defaultMeetingOrganizerObjectId
      : null;

    if (input.defaultMeetingOrganizerUpn !== undefined && defaultMeetingOrganizerUpn) {
      if (!profileValidation.profile) {
        return { success: false, error: 'A Microsoft profile must be selected before saving a Teams meeting organizer' };
      }

      const organizerLookup = await resolveOrganizerObjectId(tenant, profileValidation.profile, defaultMeetingOrganizerUpn);
      if (organizerLookup.error) {
        return { success: false, error: organizerLookup.error };
      }
      defaultMeetingOrganizerObjectId = organizerLookup.objectId || null;
    }

    const downloadRecordings = input.downloadRecordings === undefined
      ? next.downloadRecordings
      : Boolean(input.downloadRecordings);
    const exposeRecordingsInPortal = input.exposeRecordingsInPortal === undefined
      ? next.exposeRecordingsInPortal
      : Boolean(input.exposeRecordingsInPortal);
    const now = new Date();

    const row: TeamsIntegrationRow = {
      tenant,
      selected_profile_id: selectedProfileId ?? null,
      install_status: installStatus,
      enabled_capabilities: toJsonbValue(enabledCapabilities),
      notification_categories: toJsonbValue(notificationCategories),
      allowed_actions: toJsonbValue(allowedActions),
      app_id: selectedProfileChanged ? null : next.appId,
      bot_id: selectedProfileChanged ? null : next.botId,
      package_metadata:
        selectedProfileChanged || !next.packageMetadata ? null : toJsonbValue(next.packageMetadata),
      last_error: lastError || null,
      default_meeting_organizer_upn: defaultMeetingOrganizerUpn,
      default_meeting_organizer_object_id: defaultMeetingOrganizerObjectId,
      download_recordings: downloadRecordings,
      expose_recordings_in_portal: exposeRecordingsInPortal,
      created_by: existing?.created_by || (user as any)?.user_id || null,
      updated_by: (user as any)?.user_id || null,
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    if (existing) {
      // Citus distributes teams_integrations by `tenant`; the distribution column
      // must never appear in an UPDATE SET clause, even when the value is unchanged.
      const { tenant: _tenant, created_at: _createdAt, created_by: _createdBy, ...updatePayload } = row;
      await db.table('teams_integrations').update(updatePayload);
    } else {
      await db.table('teams_integrations').insert(row);
    }

    return {
      success: true,
      integration: mapTeamsIntegrationRow(row),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to save Teams integration settings' };
  }
}

export const getTeamsIntegrationStatus = withAuth(async (
  user,
  { tenant }
): Promise<TeamsIntegrationStatusResponse> => {
  const availability = resolveTeamsAvailability({ tenantId: tenant });
  if (availability.enabled === false) {
    return { success: false, error: availability.message };
  }

  return getTeamsIntegrationStatusImpl(user, { tenant });
});

export async function getTeamsIntegrationExecutionState(
  tenant: string
): Promise<TeamsIntegrationExecutionState> {
  return getTeamsIntegrationExecutionStateImpl(tenant);
}

export const saveTeamsIntegrationSettings = withAuth(async (
  user,
  { tenant },
  input: TeamsIntegrationSettingsInput
): Promise<TeamsIntegrationStatusResponse> => {
  const availability = resolveTeamsAvailability({ tenantId: tenant });
  if (availability.enabled === false) {
    return { success: false, error: availability.message };
  }

  return saveTeamsIntegrationSettingsImpl(user, { tenant }, input);
});

async function loadEeTeamsActions(): Promise<EeTeamsDiagnosticsActions> {
  return import('@alga-psa/ee-microsoft-teams/actions');
}

export const runTeamsDiagnostics = withAuth(async (
  user,
  { tenant },
  input: Record<string, never> = {}
): Promise<TeamsDiagnosticsReport> => {
  const availability = resolveTeamsAvailability({ tenantId: tenant });
  if (availability.enabled === false) {
    throw new Error(availability.message);
  }

  const actions = await loadEeTeamsActions();
  return actions.runTeamsDiagnosticsImpl(user, { tenant }, input);
});

export const sendTeamsTestMessage = withAuth(async (
  user,
  { tenant },
  input: Record<string, never> = {}
): Promise<TeamsTestMessageResult> => {
  const availability = resolveTeamsAvailability({ tenantId: tenant });
  if (availability.enabled === false) {
    throw new Error(availability.message);
  }

  const actions = await loadEeTeamsActions();
  return actions.sendTeamsTestMessageImpl(user, { tenant }, input);
});
