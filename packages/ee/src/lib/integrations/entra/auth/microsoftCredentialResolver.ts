import { resolveMicrosoftConsumerProfileConfigBound } from '@alga-psa/integrations/lib/microsoftConsumerProfileResolution';

export type MicrosoftCredentialSource = 'profile';

export interface MicrosoftOAuthCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string | null;
  source: MicrosoftCredentialSource;
  profileId: string;
  profileDisplayName: string;
}

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveMicrosoftCredentialsForTenant(
  tenant: string
): Promise<MicrosoftOAuthCredentials | null> {
  const resolution = await resolveMicrosoftConsumerProfileConfigBound(tenant, 'entra');
  const clientId = normalize(resolution.clientId);
  const clientSecret = normalize(resolution.clientSecret);
  if (resolution.status !== 'ready' || !clientId || !clientSecret || !resolution.profileId) return null;
  return {
    clientId,
    clientSecret,
    tenantId: normalize(resolution.microsoftTenantId),
    source: 'profile',
    profileId: resolution.profileId,
    profileDisplayName: resolution.profileDisplayName || resolution.profileId,
  };
}
