export type ImapCredentialSecretKind = 'password' | 'refresh_token' | 'oauth_client_secret' | 'access_token';

/**
 * Legacy rows use fixed keys. Once a destination changes, the persisted
 * generation selects a new key namespace and fallback providers cannot expose
 * a value stored under the previous fixed key.
 */
export function imapCredentialSecretKey(
  kind: ImapCredentialSecretKind,
  providerId: string,
  credentialGeneration?: string | null
): string {
  const prefix = `imap_${kind}_${providerId}`;
  return credentialGeneration ? `${prefix}_${credentialGeneration}` : prefix;
}

export async function getImapCredentialSecret(
  secretProvider: { getTenantSecret(tenant: string, key: string): Promise<string | undefined> },
  tenant: string,
  providerId: string,
  kind: ImapCredentialSecretKind,
  credentialGeneration?: string | null
): Promise<string | undefined> {
  return secretProvider.getTenantSecret(
    tenant,
    imapCredentialSecretKey(kind, providerId, credentialGeneration)
  );
}

export async function setImapCredentialSecret(
  secretProvider: { setTenantSecret(tenant: string, key: string, value: string | null): Promise<void> },
  tenant: string,
  providerId: string,
  kind: ImapCredentialSecretKind,
  value: string,
  credentialGeneration?: string | null
): Promise<void> {
  await secretProvider.setTenantSecret(
    tenant,
    imapCredentialSecretKey(kind, providerId, credentialGeneration),
    value
  );
}
