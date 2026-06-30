import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import type { TeamsMicrosoftProviderResolution } from '@alga-psa/auth/sso/teamsMicrosoftProviderResolution';

type TeamsInstallStatus = 'not_configured' | 'install_pending' | 'active' | 'error';

interface TeamsIntegrationRow {
  tenant: string;
  selected_profile_id: string | null;
  install_status: TeamsInstallStatus;
}

interface MicrosoftProfileRow {
  tenant: string;
  profile_id: string;
  client_id: string;
  tenant_id: string;
  client_secret_ref: string;
  is_archived: boolean;
}

function normalizeTenantId(value?: string | null): string {
  return (value || '').trim() || 'common';
}

function isConfigured(value?: string | null): boolean {
  return Boolean((value || '').trim());
}

export async function resolveTeamsMicrosoftProviderConfigImpl(
  tenantId: string
): Promise<TeamsMicrosoftProviderResolution> {
  const conn = await getAdminConnection();
  const db = tenantDb(conn, tenantId);
  const integration = await db.table<TeamsIntegrationRow>('teams_integrations')
    .first();

  if (!integration || integration.install_status === 'not_configured' || !integration.selected_profile_id) {
    return {
      status: 'not_configured',
      tenantId,
      message: 'Teams is not configured for this tenant',
    };
  }

  const profile = await db.table<MicrosoftProfileRow>('microsoft_profiles')
    .where({ profile_id: integration.selected_profile_id })
    .first();

  if (!profile || profile.is_archived) {
    return {
      status: 'invalid_profile',
      tenantId,
      profileId: integration.selected_profile_id,
      message: 'Selected Teams Microsoft profile is missing or archived',
    };
  }

  const secretProvider = await getSecretProviderInstance();
  const clientSecret = await secretProvider.getTenantSecret(tenantId, profile.client_secret_ref);

  if (!isConfigured(profile.client_id) || !isConfigured(clientSecret)) {
    return {
      status: 'invalid_profile',
      tenantId,
      profileId: profile.profile_id,
      message: 'Selected Teams Microsoft profile is missing required credentials',
    };
  }

  return {
    status: 'ready',
    tenantId,
    profileId: profile.profile_id,
    clientId: profile.client_id,
    clientSecret: clientSecret || undefined,
    microsoftTenantId: normalizeTenantId(profile.tenant_id),
  };
}
