import { createTenantKnex } from '@alga-psa/db';
import { ADD_ONS } from '@alga-psa/types';
import { resolveTeamsMicrosoftProviderConfigImpl } from '../auth/teamsMicrosoftProviderResolution';

type TeamsInstallStatus = 'not_configured' | 'install_pending' | 'active' | 'error';

interface TeamsMeetingIntegrationRow {
  tenant: string;
  selected_profile_id: string | null;
  install_status: TeamsInstallStatus;
  default_meeting_organizer_upn: string | null;
}

export interface TeamsMeetingExecutionConfig {
  organizerUpn: string;
  clientId: string;
  clientSecret: string;
  microsoftTenantId: string;
}

export interface TeamsMeetingGraphConfig {
  organizerUpn: string | null;
  clientId: string;
  clientSecret: string;
  microsoftTenantId: string;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function tenantHasTeamsAddOn(knex: any, tenantId: string): Promise<boolean> {
  const row = await knex('tenant_addons')
    .where({ tenant: tenantId, addon_key: ADD_ONS.TEAMS })
    .andWhere((builder: any) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now());
    })
    .first('addon_key');

  return Boolean(row);
}

export async function resolveTeamsMeetingGraphConfig(
  tenantId: string
): Promise<TeamsMeetingGraphConfig | null> {
  const { knex } = await createTenantKnex(tenantId);
  if (!(await tenantHasTeamsAddOn(knex, tenantId))) {
    return null;
  }

  const integration = await knex<TeamsMeetingIntegrationRow>('teams_integrations')
    .where({ tenant: tenantId })
    .first();

  if (!integration || integration.install_status !== 'active' || !integration.selected_profile_id) {
    return null;
  }

  const providerConfig = await resolveTeamsMicrosoftProviderConfigImpl(tenantId);
  if (
    providerConfig.status !== 'ready' ||
    !providerConfig.clientId ||
    !providerConfig.clientSecret ||
    !providerConfig.microsoftTenantId
  ) {
    return null;
  }

  return {
    organizerUpn: normalizeString(integration.default_meeting_organizer_upn) || null,
    clientId: providerConfig.clientId,
    clientSecret: providerConfig.clientSecret,
    microsoftTenantId: providerConfig.microsoftTenantId,
  };
}

export async function resolveTeamsMeetingExecutionConfig(
  tenantId: string
): Promise<TeamsMeetingExecutionConfig | null> {
  const config = await resolveTeamsMeetingGraphConfig(tenantId);
  if (!config?.organizerUpn) {
    return null;
  }

  return {
    organizerUpn: config.organizerUpn,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    microsoftTenantId: config.microsoftTenantId,
  };
}
