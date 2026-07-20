import { getSecretProviderInstance } from '../../core/secretProvider';
import { getAdminConnection } from '../../db/admin';
import { tenantDb } from '@alga-psa/db';
import type { EmailProviderConfig } from '../../interfaces/inbound-email.interfaces';

export type MicrosoftEmailCredentialSource = 'profile' | 'vendor' | 'environment' | 'legacy';

export interface MicrosoftEmailRuntimeCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  profileId?: string;
  clientSecretRef?: string;
  source: MicrosoftEmailCredentialSource;
}

export function selectMicrosoftEmailRuntimeCredentials(params: {
  issuingClientId?: string;
  profileCredentials: MicrosoftEmailRuntimeCredentials | null;
  fallbackCredentials: MicrosoftEmailRuntimeCredentials | null;
}): MicrosoftEmailRuntimeCredentials | null {
  const issuingClientId = normalized(params.issuingClientId);
  if (
    params.profileCredentials &&
    (!issuingClientId || params.profileCredentials.clientId === issuingClientId)
  ) {
    return params.profileCredentials;
  }
  if (
    params.fallbackCredentials &&
    (!issuingClientId || params.fallbackCredentials.clientId === issuingClientId)
  ) {
    return params.fallbackCredentials;
  }
  return null;
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasEmailCapability(value: unknown): boolean {
  let capabilities = value;
  if (typeof capabilities === 'string') {
    try {
      capabilities = JSON.parse(capabilities);
    } catch {
      capabilities = null;
    }
  }
  return !Array.isArray(capabilities) || capabilities.includes('email');
}

async function resolveBoundProfileCredentials(
  tenant: string
): Promise<MicrosoftEmailRuntimeCredentials | null> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenant);
  const query = db.table('microsoft_profile_consumer_bindings as binding');
  db.tenantJoin(query, 'microsoft_profiles as profile', 'binding.profile_id', 'profile.profile_id');
  const profile = await query
    .where('binding.consumer_type', 'email')
    .andWhere('profile.is_archived', false)
    .first(
      'profile.profile_id',
      'profile.client_id',
      'profile.client_secret_ref',
      'profile.tenant_id',
      'profile.capabilities'
    );

  if (!profile || !hasEmailCapability(profile.capabilities)) return null;
  const secretProvider = await getSecretProviderInstance();
  const clientSecret = normalized(
    await secretProvider.getTenantSecret(tenant, profile.client_secret_ref)
  );
  const clientId = normalized(profile.client_id);
  if (!clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    tenantId: normalized(profile.tenant_id) || 'common',
    profileId: profile.profile_id,
    clientSecretRef: profile.client_secret_ref,
    source: 'profile',
  };
}

async function resolveFallbackCredentials(
  tenant: string,
  vendorConfig: NonNullable<EmailProviderConfig['provider_config']>,
  issuingClientId: string
): Promise<MicrosoftEmailRuntimeCredentials | null> {
  const matchesIssuer = (clientId: string) => !issuingClientId || clientId === issuingClientId;
  const vendorClientId = normalized(vendorConfig.client_id);
  const vendorClientSecret = normalized(vendorConfig.client_secret);
  if (vendorClientId && vendorClientSecret && matchesIssuer(vendorClientId)) {
    return {
      clientId: vendorClientId,
      clientSecret: vendorClientSecret,
      tenantId: normalized(vendorConfig.tenant_id || vendorConfig.tenantId) || 'common',
      profileId: normalized(vendorConfig.microsoft_profile_id) || undefined,
      clientSecretRef: normalized(vendorConfig.client_secret_ref) || undefined,
      source: 'vendor',
    };
  }

  const secretProvider = await getSecretProviderInstance();
  const [appClientId, appClientSecret, appTenantId] = await Promise.all([
    secretProvider.getAppSecret('MICROSOFT_CLIENT_ID'),
    secretProvider.getAppSecret('MICROSOFT_CLIENT_SECRET'),
    secretProvider.getAppSecret('MICROSOFT_TENANT_ID'),
  ]);
  const envClientId = normalized(appClientId || process.env.MICROSOFT_CLIENT_ID);
  const envClientSecret = normalized(appClientSecret || process.env.MICROSOFT_CLIENT_SECRET);
  if (envClientId && envClientSecret && matchesIssuer(envClientId)) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      tenantId: normalized(appTenantId || process.env.MICROSOFT_TENANT_ID) || 'common',
      source: 'environment',
    };
  }

  const [clientId, clientSecret, tenantId] = await Promise.all([
    secretProvider.getTenantSecret(tenant, 'microsoft_client_id'),
    secretProvider.getTenantSecret(tenant, 'microsoft_client_secret'),
    secretProvider.getTenantSecret(tenant, 'microsoft_tenant_id'),
  ]);
  if (!normalized(clientId) || !normalized(clientSecret) || !matchesIssuer(normalized(clientId))) return null;
  return {
    clientId: normalized(clientId),
    clientSecret: normalized(clientSecret),
    tenantId: normalized(tenantId) || 'common',
    source: 'legacy',
  };
}

/**
 * Resolves credentials before adapter construction. The client id stored on the
 * vendor row pins an existing refresh token to its issuing app. A newly-bound
 * profile may supply a rotated secret only when its client id still matches.
 */
export async function buildMicrosoftEmailProviderConfig(
  config: EmailProviderConfig
): Promise<EmailProviderConfig> {
  const vendorConfig = config.provider_config || {};
  const issuingClientId = normalized(vendorConfig.client_id);
  const profileCredentials = await resolveBoundProfileCredentials(config.tenant);
  const fallbackCredentials = await resolveFallbackCredentials(
    config.tenant,
    vendorConfig,
    issuingClientId
  );

  const selected = selectMicrosoftEmailRuntimeCredentials({
    issuingClientId,
    profileCredentials,
    fallbackCredentials,
  });

  if (!selected) {
    throw new Error(
      `Microsoft OAuth client credentials are not configured for email provider ${config.id}`
    );
  }

  return {
    ...config,
    provider_config: {
      ...vendorConfig,
      resolved_client_id: selected.clientId,
      resolved_client_secret: selected.clientSecret,
      resolved_tenant_id: selected.tenantId,
      resolved_credential_source: selected.source,
      resolved_profile_id: selected.profileId,
      resolved_client_secret_ref: selected.clientSecretRef,
    },
  };
}
