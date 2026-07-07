import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { ADD_ONS } from '@alga-psa/types';
import { resolveTeamsMicrosoftProviderConfigImpl } from '../auth/teamsMicrosoftProviderResolution';

type TeamsInstallStatus = 'not_configured' | 'install_pending' | 'active' | 'error';

interface TeamsMeetingIntegrationRow {
  tenant: string;
  selected_profile_id: string | null;
  install_status: TeamsInstallStatus;
  default_meeting_organizer_upn: string | null;
  default_meeting_organizer_object_id?: string | null;
  send_meeting_invites?: boolean | null;
}

export interface TeamsMeetingExecutionConfig {
  organizerUpn: string;
  organizerUserId: string;
  clientId: string;
  clientSecret: string;
  microsoftTenantId: string;
  sendMeetingInvites: boolean;
}

export interface TeamsMeetingGraphConfig {
  organizerUpn: string | null;
  organizerUserId: string | null;
  clientId: string;
  clientSecret: string;
  microsoftTenantId: string;
  sendMeetingInvites: boolean;
}

export type TeamsMeetingConfigSkipReason = 'addon_inactive' | 'not_configured' | 'no_organizer';

export type TeamsMeetingConfigState =
  | { status: 'ready'; config: TeamsMeetingExecutionConfig }
  | { status: 'skipped'; reason: TeamsMeetingConfigSkipReason };

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function tenantHasTeamsAddOn(knex: any, tenantId: string): Promise<boolean> {
  const row = await tenantDb(knex, tenantId).table('tenant_addons')
    .where({ addon_key: ADD_ONS.TEAMS })
    .andWhere((builder: any) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now());
    })
    .first('addon_key');

  return Boolean(row);
}

type GraphConfigResolution =
  | { status: 'ready'; config: TeamsMeetingGraphConfig }
  | { status: 'skipped'; reason: 'addon_inactive' | 'not_configured' };

async function resolveGraphConfigState(tenantId: string): Promise<GraphConfigResolution> {
  const { knex } = await createTenantKnex(tenantId);
  if (!(await tenantHasTeamsAddOn(knex, tenantId))) {
    return { status: 'skipped', reason: 'addon_inactive' };
  }

  const integration = await tenantDb(knex, tenantId).table<TeamsMeetingIntegrationRow>('teams_integrations')
    .first();

  if (!integration || integration.install_status !== 'active' || !integration.selected_profile_id) {
    return { status: 'skipped', reason: 'not_configured' };
  }

  const providerConfig = await resolveTeamsMicrosoftProviderConfigImpl(tenantId);
  if (
    providerConfig.status !== 'ready' ||
    !providerConfig.clientId ||
    !providerConfig.clientSecret ||
    !providerConfig.microsoftTenantId
  ) {
    return { status: 'skipped', reason: 'not_configured' };
  }

  return {
    status: 'ready',
    config: {
      organizerUpn: normalizeString(integration.default_meeting_organizer_upn) || null,
      organizerUserId: normalizeString(integration.default_meeting_organizer_object_id) || null,
      clientId: providerConfig.clientId,
      clientSecret: providerConfig.clientSecret,
      microsoftTenantId: providerConfig.microsoftTenantId,
      // Default on when the column is absent/null (pre-migration rows).
      sendMeetingInvites: integration.send_meeting_invites !== false,
    },
  };
}

export async function resolveTeamsMeetingGraphConfig(
  tenantId: string
): Promise<TeamsMeetingGraphConfig | null> {
  const resolution = await resolveGraphConfigState(tenantId);
  return resolution.status === 'ready' ? resolution.config : null;
}

export async function resolveTeamsMeetingConfigState(
  tenantId: string
): Promise<TeamsMeetingConfigState> {
  const resolution = await resolveGraphConfigState(tenantId);
  if (resolution.status !== 'ready') {
    return resolution;
  }

  const config = resolution.config;
  if (!config.organizerUpn) {
    return { status: 'skipped', reason: 'no_organizer' };
  }

  return {
    status: 'ready',
    config: {
      organizerUpn: config.organizerUpn,
      organizerUserId: config.organizerUserId || config.organizerUpn,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      microsoftTenantId: config.microsoftTenantId,
      sendMeetingInvites: config.sendMeetingInvites,
    },
  };
}

export async function resolveTeamsMeetingExecutionConfig(
  tenantId: string
): Promise<TeamsMeetingExecutionConfig | null> {
  const state = await resolveTeamsMeetingConfigState(tenantId);
  return state.status === 'ready' ? state.config : null;
}
