import { getSecretProviderInstance } from '../../core/secretProvider';
import { getAdminConnection } from '../../db/admin';
import { tenantDb } from '@alga-psa/db';
import type { EmailProviderConfig } from '../../interfaces/inbound-email.interfaces';
import { MICROSOFT_TEAMS_APP_CLIENT_ID } from './microsoftGraphEndpoints';

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

function isTeamsAppClientId(clientId: string): boolean {
  const normalizedClientId = clientId.trim().toLowerCase();
  return Boolean(normalizedClientId) && normalizedClientId === MICROSOFT_TEAMS_APP_CLIENT_ID.toLowerCase();
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

  if (!profile || !hasEmailCapability(profile.capabilities) || isTeamsAppClientId(normalized(profile.client_id))) return null;
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

/**
 * Resolve credentials from the provider row's pinned profile (the persisted
 * `microsoft_profile_id` + `client_secret_ref`), which is authoritative for the
 * app that issued the refresh token. Unlike the current Email binding this
 * keeps working after a binding change, and it lets a same-client secret
 * rotation flow through without a reconnect.
 */
async function resolveProviderPinnedProfileCredentials(
  tenant: string,
  vendorConfig: NonNullable<EmailProviderConfig['provider_config']>
): Promise<MicrosoftEmailRuntimeCredentials | null> {
  const profileId = normalized(vendorConfig.microsoft_profile_id);
  const secretRef = normalized(vendorConfig.client_secret_ref);
  if (!profileId || !secretRef) return null;

  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenant);
  const profile = await db
    .table('microsoft_profiles')
    .where({ profile_id: profileId })
    .first(
      'profile_id',
      'client_id',
      'client_secret_ref',
      'tenant_id',
      'capabilities',
      'is_archived'
    );

  if (!profile || profile.is_archived || !hasEmailCapability(profile.capabilities) || isTeamsAppClientId(normalized(profile.client_id))) return null;
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
 * vendor row pins an existing refresh token to its issuing app. A provider
 * pinned to a tenant profile (persisted `microsoft_profile_id`) is resolved
 * *only* through that profile: an unresolvable pin (profile deleted, archived,
 * secret missing, capability removed) is a hard failure, never a silent
 * fallback to the current Email binding. Providers without a profile pin
 * (managed or legacy rows) fall back to stored/environment/legacy credentials
 * that still match the pinned client id; the current Email binding may narrow a
 * same-client candidate but never supplies a different app.
 */
export async function buildMicrosoftEmailProviderConfig(
  config: EmailProviderConfig
): Promise<EmailProviderConfig> {
  const vendorConfig = config.provider_config || {};
  const issuingClientId = normalized(vendorConfig.client_id);
  const profileId = normalized(vendorConfig.microsoft_profile_id);
  const hasProfilePin = Boolean(profileId);

  let selected: MicrosoftEmailRuntimeCredentials | null = null;
  if (hasProfilePin) {
    const pinnedProfileCredentials = await resolveProviderPinnedProfileCredentials(config.tenant, vendorConfig);
    if (!pinnedProfileCredentials) {
      throw new Error(
        `Microsoft email provider ${config.id} is pinned to profile ${profileId}, but that profile's credentials cannot be resolved (profile deleted, archived, or its secret/capability missing). Reconnect the mailbox to re-authorize it. (ms_email_provider_not_found)`
      );
    }
    if (issuingClientId && !isSameClientId(issuingClientId, pinnedProfileCredentials.clientId)) {
      throw new Error(
        `Microsoft email provider ${config.id} is pinned to profile ${profileId} with client ${pinnedProfileCredentials.clientId}, which does not match the persisted issuing client ${issuingClientId}. Reconnect the mailbox to re-authorize it. (ms_email_client_mismatch_reconnect_required)`
      );
    }
    selected = pinnedProfileCredentials;
  } else {
    const [boundProfileCredentials, fallbackCredentials] = await Promise.all([
      resolveBoundProfileCredentials(config.tenant),
      resolveFallbackCredentials(config.tenant, vendorConfig, issuingClientId),
    ]);

    selected = selectMicrosoftEmailRuntimeCredentials({
      issuingClientId,
      profileCredentials: boundProfileCredentials,
      fallbackCredentials,
    });
  }

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

function isSameClientId(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
