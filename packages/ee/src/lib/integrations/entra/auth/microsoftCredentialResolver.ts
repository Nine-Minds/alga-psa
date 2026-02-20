export type MicrosoftCredentialSource = 'tenant-secret' | 'env' | 'app-secret';

export interface MicrosoftOAuthCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string | null;
  source: MicrosoftCredentialSource;
}

export async function resolveMicrosoftCredentialsForTenant(
  _tenant: string
): Promise<MicrosoftOAuthCredentials | null> {
  return null;
}
