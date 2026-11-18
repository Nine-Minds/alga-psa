import type { EntraCippCredentials } from './cippSecretStore';

export interface EntraCippStatusDetails {
  cippBaseUrl: string | null;
  cippAuthType: 'api_client' | 'legacy_api_token' | null;
  cippClientId: string | null;
  cippDirectoryId: string | null;
}

/**
 * The non-secret view of a stored CIPP credential, for the status payload the
 * browser receives. Built field by field rather than spread: the client secret
 * and the legacy API key must never be reachable from here, whatever fields the
 * credential type grows later.
 */
export function buildCippStatusDetails(
  credentials: EntraCippCredentials | null | undefined
): EntraCippStatusDetails {
  return {
    cippBaseUrl: credentials?.baseUrl || null,
    cippAuthType: credentials?.authType ?? null,
    cippClientId: credentials?.authType === 'api_client' ? credentials.clientId : null,
    cippDirectoryId: credentials?.authType === 'api_client' ? credentials.directoryId : null,
  };
}
