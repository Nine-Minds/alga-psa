import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
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
} from '../../teams/teamsShared';
import type {
  TeamsIntegrationExecutionState,
  TeamsIntegrationSettingsInput,
  TeamsIntegrationStatusResponse,
} from '../../teams/teamsContracts';

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
  if (!Array.isArray(values)) {
    return [];
  }

  const requested = new Set(values.filter((value): value is T => typeof value === 'string' && supported.includes(value as T)));
  return supported.filter((value) => requested.has(value));
}

function toJsonbValue<T>(value: T): string {
  return JSON.stringify(value);
}

function defaultTeamsIntegrationState() {
  return {
    selectedProfileId: null,
    installStatus: 'not_configured' as TeamsInstallStatus,
    enabledCapabilities: [...TEAMS_CAPABILITIES] as TeamsCapability[],
    notificationCategories: [...TEAMS_NOTIFICATION_CATEGORIES] as TeamsNotificationCategory[],
    allowedActions: [...TEAMS_ALLOWED_ACTIONS] as TeamsAllowedAction[],
    appId: null as string | null,
    botId: null as string | null,
    packageMetadata: null as Record<string, unknown> | null,
    lastError: null as string | null,
  };
}

function mapTeamsIntegrationRow(row?: TeamsIntegrationRow | null): NonNullable<TeamsIntegrationStatusResponse['integration']> {
  if (!row) {
    return defaultTeamsIntegrationState();
  }

  return {
    selectedProfileId: row.selected_profile_id || null,
    installStatus: isTeamsInstallStatus(row.install_status) ? row.install_status : 'not_configured',
    enabledCapabilities: normalizeEnumArray(row.enabled_capabilities, TEAMS_CAPABILITIES),
    notificationCategories: normalizeEnumArray(row.notification_categories, TEAMS_NOTIFICATION_CATEGORIES),
    allowedActions: normalizeEnumArray(row.allowed_actions, TEAMS_ALLOWED_ACTIONS),
    appId: row.app_id || null,
    botId: row.bot_id || null,
    packageMetadata: row.package_metadata && typeof row.package_metadata === 'object'
      ? row.package_metadata as Record<string, unknown>
      : null,
    lastError: row.last_error || null,
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

async function validateSelectedProfile(
  knex: any,
  tenant: string,
  profileId: string | null,
  requireReady: boolean
): Promise<{ profile?: MicrosoftProfileRow; error?: string }> {
  if (!profileId) {
    return requireReady ? { error: 'A Microsoft profile must be selected before Teams can be activated' } : {};
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

export async function getTeamsIntegrationStatusImpl(
  user: unknown,
  { tenant }: { tenant: string }
): Promise<TeamsIntegrationStatusResponse> {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
    if (!(await canManageTeamsSettings(user))) return { success: false, error: 'Forbidden' };

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

export async function getTeamsIntegrationExecutionStateImpl(
  tenant: string
): Promise<TeamsIntegrationExecutionState> {
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
  };
}

export async function saveTeamsIntegrationSettingsImpl(
  user: unknown,
  { tenant }: { tenant: string },
  input: TeamsIntegrationSettingsInput
): Promise<TeamsIntegrationStatusResponse> {
  try {
    if (isClientPortalUser(user)) return { success: false, error: 'Forbidden' };
    if (!(await canManageTeamsSettings(user))) return { success: false, error: 'Forbidden' };

    const { knex } = await createTenantKnex();

    const existing = await getTeamsIntegrationRow(knex, tenant);
    const next = {
      ...defaultTeamsIntegrationState(),
      ...mapTeamsIntegrationRow(existing),
    };

    const selectedProfileId = input.selectedProfileId === undefined ? next.selectedProfileId : input.selectedProfileId;
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

    const selectedProfileChanged = Boolean(existing?.selected_profile_id) && existing?.selected_profile_id !== (selectedProfileId ?? null);
    const installStatus = selectedProfileChanged && requestedInstallStatus !== 'not_configured'
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
      package_metadata: selectedProfileChanged || !next.packageMetadata
        ? null
        : toJsonbValue(next.packageMetadata),
      last_error: lastError || null,
      created_by: existing?.created_by || (user as any)?.user_id || null,
      updated_by: (user as any)?.user_id || null,
      created_at: existing?.created_at || now,
      updated_at: now,
    };

    if (existing) {
      await knex('teams_integrations').where({ tenant }).update(row);
    } else {
      await knex('teams_integrations').insert(row);
    }

    return {
      success: true,
      integration: mapTeamsIntegrationRow(row),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to save Teams integration settings' };
  }
}
