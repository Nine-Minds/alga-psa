import { createTenantKnex } from '@alga-psa/db';
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

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function resolveTeamsMeetingExecutionConfig(
  tenantId: string
): Promise<TeamsMeetingExecutionConfig | null> {
  const { knex } = await createTenantKnex(tenantId);
  const integration = await knex<TeamsMeetingIntegrationRow>('teams_integrations')
    .where({ tenant: tenantId })
    .first();

  if (!integration || integration.install_status !== 'active' || !integration.selected_profile_id) {
    return null;
  }

  const organizerUpn = normalizeString(integration.default_meeting_organizer_upn);
  if (!organizerUpn) {
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
    organizerUpn,
    clientId: providerConfig.clientId,
    clientSecret: providerConfig.clientSecret,
    microsoftTenantId: providerConfig.microsoftTenantId,
  };
}
