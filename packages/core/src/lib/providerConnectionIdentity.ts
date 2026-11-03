import { createHash } from 'node:crypto';

/** Secret-free fields that identify the endpoint and principal a credential authenticates. */
export const CONNECTION_IDENTITY_FIELDS: Record<string, readonly string[]> = {
  smtp: ['host', 'port', 'username', 'secure', 'ignoreTLS', 'requireTLS', 'rejectUnauthorized'],
  imap: ['host', 'port', 'secure', 'username'],
  microsoft: ['inboundProviderId', 'providerId', 'tenantId', 'clientId'],
  resend: ['providerId'],
};

/** Provider-specific legacy credential names, normalized before any secret handling. */
const SECRET_ALIASES: Record<string, Readonly<Record<string, string>>> = {
  resend: { api_key: 'apiKey' },
};

/**
 * Return a canonical provider config. Conflicting spellings are ambiguous and
 * rejected without including either credential value in the error.
 */
export function normalizeProviderSecretAliases(
  config: Record<string, unknown>,
  providerType: string,
): Record<string, unknown> {
  const normalized = { ...config };
  for (const [aliasProviderType, aliases] of Object.entries(SECRET_ALIASES)) {
    for (const [alias, canonical] of Object.entries(aliases)) {
      if (!Object.prototype.hasOwnProperty.call(normalized, alias)) continue;
      if (aliasProviderType !== providerType) throw new Error('Provider credential alias does not match provider type');
      if (Object.prototype.hasOwnProperty.call(normalized, canonical)
        && normalized[alias] !== normalized[canonical]) {
        throw new Error('Conflicting provider credential fields');
      }
      if (!Object.prototype.hasOwnProperty.call(normalized, canonical)) normalized[canonical] = normalized[alias];
      delete normalized[alias];
    }
  }
  return normalized;
}

/** Stable SHA-256 fingerprint of the provider's canonical, non-secret identity. */
export function connectionFingerprint(config: Record<string, unknown>, providerType?: string, providerId?: string): string {
  const type = providerType ?? (typeof config.providerType === 'string' ? config.providerType : 'smtp');
  config = normalizeProviderSecretAliases(config, type);
  if (providerId !== undefined) config = { ...config, providerId };
  const fields = CONNECTION_IDENTITY_FIELDS[type] ?? ['providerId'];
  const canonical: Record<string, unknown> = {};
  for (const field of [...fields].sort()) {
    canonical[field] = config[field] ?? null;
  }
  return createHash('sha256').update(JSON.stringify({ providerType: type, identity: canonical })).digest('hex');
}

export function providerSecretFingerprintMatches(provider: { providerType: string; providerId?: string; config?: Record<string, unknown> }): boolean {
  let config: Record<string, unknown>;
  try {
    config = normalizeProviderSecretAliases(provider.config ?? {}, provider.providerType);
  } catch {
    return false;
  }
  const hasSecret = Boolean(config.password || config.apiKey);
  if (!hasSecret) return true;
  return typeof config.__secretFingerprint === 'string'
    && config.__secretFingerprint === connectionFingerprint(config, provider.providerType, provider.providerId);
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
