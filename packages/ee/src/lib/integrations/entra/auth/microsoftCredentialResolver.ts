// Kept local to @alga-psa/ee-stubs to avoid a package cycle through @alga-psa/integrations.
// LEVERAGE: pattern microsoft-consumer-binding-resolution — fourth local binding→profile→secret lookup; defer extraction because edition aliasing is a correctness boundary.
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';

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

interface EntraMicrosoftProfile {
  profile_id: string;
  display_name: string;
  client_id: string;
  tenant_id: string;
  client_secret_ref: string;
  capabilities: string[] | string | null;
  is_archived: boolean;
}

function hasEntraCapability(capabilities: EntraMicrosoftProfile['capabilities']): boolean {
  if (typeof capabilities === 'string') {
    try {
      capabilities = JSON.parse(capabilities);
    } catch {
      return false;
    }
  }
  return Array.isArray(capabilities) && capabilities.includes('entra');
}

export async function resolveMicrosoftCredentialsForTenant(
  tenant: string
): Promise<MicrosoftOAuthCredentials | null> {
  const db = await getAdminConnection();
  const binding = await tenantDb(db, tenant)
    .table('microsoft_profile_consumer_bindings')
    .where({ consumer_type: 'entra' })
    .first() as { profile_id: string } | undefined;
  if (!binding) return null;

  const profile = await tenantDb(db, tenant)
    .table('microsoft_profiles')
    .where({ profile_id: binding.profile_id })
    .first() as EntraMicrosoftProfile | undefined;
  if (!profile || profile.is_archived || !hasEntraCapability(profile.capabilities)) return null;

  const clientId = normalize(profile.client_id);
  const clientSecret = normalize(await (await getSecretProviderInstance()).getTenantSecret(tenant, profile.client_secret_ref));
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    tenantId: normalize(profile.tenant_id),
    source: 'profile',
    profileId: profile.profile_id,
    profileDisplayName: profile.display_name || profile.profile_id,
  };
}
