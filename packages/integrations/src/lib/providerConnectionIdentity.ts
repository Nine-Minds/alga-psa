import { createHash } from 'node:crypto';

/** Secret-free fields that identify the endpoint and principal a credential authenticates. */
export const CONNECTION_IDENTITY_FIELDS: Record<string, readonly string[]> = {
  smtp: ['host', 'port', 'username', 'secure', 'ignoreTLS', 'requireTLS', 'rejectUnauthorized'],
  imap: ['host', 'port', 'secure', 'username'],
  microsoft: ['inboundProviderId', 'providerId', 'tenantId', 'clientId'],
  resend: [],
};

/** Stable SHA-256 fingerprint of the provider's canonical, non-secret identity. */
export function connectionFingerprint(config: Record<string, unknown>, providerType?: string): string {
  const type = providerType ?? (typeof config.providerType === 'string' ? config.providerType : 'smtp');
  const fields = CONNECTION_IDENTITY_FIELDS[type] ?? ['providerId'];
  const canonical: Record<string, unknown> = {};
  for (const field of [...fields].sort()) {
    canonical[field] = config[field] ?? null;
  }
  return createHash('sha256').update(JSON.stringify({ providerType: type, identity: canonical })).digest('hex');
}

export function providerSecretFingerprintMatches(provider: { providerType: string; config?: Record<string, unknown> }): boolean {
  const config = provider.config ?? {};
  const hasSecret = Boolean(config.password || config.apiKey);
  if (!hasSecret) return true;
  return typeof config.__secretFingerprint === 'string'
    && config.__secretFingerprint === connectionFingerprint(config, provider.providerType);
}

export const SECRET_IDENTITY_MISMATCH_MESSAGE =
  'Credentials no longer match this server. Re-enter the password for the current connection.';

export interface ProviderSecretMismatch {
  providerId?: string;
  providerType: string;
}

/**
 * The enabled provider whose stored secret no longer matches its own connection
 * identity, or null when every stored secret is still bound to the endpoint it
 * was entered for. Callers that report a failure must name THIS provider: with
 * several enabled providers, the first enabled one is not necessarily the one
 * whose credential went stale.
 */
export function findProviderSecretMismatch(settings: {
  providerConfigs?: Array<{ providerId?: string; providerType: string; isEnabled: boolean; config?: Record<string, unknown> }>;
}): ProviderSecretMismatch | null {
  const enabled = settings.providerConfigs?.filter((provider) => provider.isEnabled) ?? [];
  const failing = enabled.find((provider) => !providerSecretFingerprintMatches(provider));
  return failing ? { providerId: failing.providerId, providerType: failing.providerType } : null;
}

export function verifyProviderSecretFingerprint(settings: {
  providerConfigs?: Array<{ providerType: string; isEnabled: boolean; config?: Record<string, unknown> }>;
}): string | null {
  return findProviderSecretMismatch(settings) ? SECRET_IDENTITY_MISMATCH_MESSAGE : null;
}
