import logger from '@alga-psa/core/logger';

export interface TeamsMicrosoftProviderResolution {
  status: 'ready' | 'not_configured' | 'invalid_profile';
  tenantId: string;
  profileId?: string;
  clientId?: string;
  clientSecret?: string;
  microsoftTenantId?: string;
  message?: string;
}

let eeTeamsMicrosoftProviderResolutionPromise:
  | Promise<{
      resolveTeamsMicrosoftProviderConfigImpl?: (
        tenantId: string
      ) => Promise<TeamsMicrosoftProviderResolution>;
    }>
  | null = null;

async function loadEeTeamsMicrosoftProviderResolution() {
  if (!eeTeamsMicrosoftProviderResolutionPromise) {
    eeTeamsMicrosoftProviderResolutionPromise = import('@enterprise/lib/auth/teamsMicrosoftProviderResolution').catch((error) => {
      logger.warn('[TeamsMicrosoftProviderResolution] Failed to load EE Teams Microsoft provider resolver', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    });
  }

  return eeTeamsMicrosoftProviderResolutionPromise;
}

export async function resolveTeamsMicrosoftProviderConfig(
  tenantId: string
): Promise<TeamsMicrosoftProviderResolution> {
  const ee = await loadEeTeamsMicrosoftProviderResolution();
  if (!ee.resolveTeamsMicrosoftProviderConfigImpl) {
    return {
      status: 'not_configured',
      tenantId,
      message: 'Teams is not configured for this tenant',
    };
  }

  return ee.resolveTeamsMicrosoftProviderConfigImpl(tenantId);
}
