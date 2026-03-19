export interface TeamsMicrosoftProviderResolution {
  status: 'ready' | 'not_configured' | 'invalid_profile';
  tenantId: string;
  profileId?: string;
  clientId?: string;
  clientSecret?: string;
  microsoftTenantId?: string;
  message?: string;
}

export async function resolveTeamsMicrosoftProviderConfig(
  tenantId: string
): Promise<TeamsMicrosoftProviderResolution> {
  return {
    status: 'not_configured',
    tenantId,
    message: 'Teams Microsoft provider resolution is not available through @enterprise compatibility stubs.',
  };
}
