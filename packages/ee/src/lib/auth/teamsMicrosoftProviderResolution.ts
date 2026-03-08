import type { TeamsMicrosoftProviderResolution } from '@alga-psa/auth/sso/teamsMicrosoftProviderResolution';

export async function resolveTeamsMicrosoftProviderConfigImpl(
  tenantId: string
): Promise<TeamsMicrosoftProviderResolution> {
  return {
    status: 'not_configured',
    tenantId,
    message: 'Teams is not configured for this tenant',
  };
}
