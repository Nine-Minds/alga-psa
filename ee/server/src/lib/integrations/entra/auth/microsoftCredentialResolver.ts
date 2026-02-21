import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { ENTRA_SHARED_MICROSOFT_SECRET_KEYS } from '../secrets';

export type MicrosoftCredentialSource = 'tenant-secret' | 'env' | 'app-secret';

export interface MicrosoftOAuthCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string | null;
  source: MicrosoftCredentialSource;
}

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveMicrosoftCredentialsForTenant(
  tenant: string
): Promise<MicrosoftOAuthCredentials | null> {
  const secretProvider = await getSecretProviderInstance();

  const tenantClientId = normalize(
    await secretProvider.getTenantSecret(tenant, ENTRA_SHARED_MICROSOFT_SECRET_KEYS.clientId)
  );
  const tenantClientSecret = normalize(
    await secretProvider.getTenantSecret(tenant, ENTRA_SHARED_MICROSOFT_SECRET_KEYS.clientSecret)
  );
  const tenantTenantId = normalize(
    await secretProvider.getTenantSecret(tenant, ENTRA_SHARED_MICROSOFT_SECRET_KEYS.tenantId)
  );

  if (tenantClientId && tenantClientSecret) {
    return {
      clientId: tenantClientId,
      clientSecret: tenantClientSecret,
      tenantId: tenantTenantId,
      source: 'tenant-secret',
    };
  }

  const envClientId = normalize(process.env.MICROSOFT_CLIENT_ID);
  const envClientSecret = normalize(process.env.MICROSOFT_CLIENT_SECRET);
  const envTenantId = normalize(process.env.MICROSOFT_TENANT_ID);

  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      tenantId: envTenantId,
      source: 'env',
    };
  }

  const appClientId = normalize(
    await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID')
  );
  const appClientSecret = normalize(
    await secretProvider.getAppSecret('MICROSOFT_CLIENT_SECRET')
  );
  const appTenantId = normalize(
    await secretProvider.getAppSecret('MICROSOFT_TENANT_ID')
  );

  if (appClientId && appClientSecret) {
    return {
      clientId: appClientId,
      clientSecret: appClientSecret,
      tenantId: appTenantId,
      source: 'app-secret',
    };
  }

  return null;
}
