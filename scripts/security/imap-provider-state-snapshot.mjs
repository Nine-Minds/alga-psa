import { createHmac } from 'node:crypto';

function oauthEndpoint(value) {
  if (value == null || value === '') return { protocol: null, host: null, port: null };
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('Persisted OAuth token URL is invalid');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('Persisted OAuth token URL must use HTTPS without embedded credentials');
  }
  return { protocol: endpoint.protocol, host: endpoint.hostname.toLowerCase(), port: Number(endpoint.port || 443) };
}

/** Build a redacted provider snapshot using a run-scoped HMAC key. */
export function createImapProviderStateSnapshot({ row, database, providerId, fingerprintKey, capturedAt = new Date().toISOString() }) {
  if (!Buffer.isBuffer(fingerprintKey) || fingerprintKey.length < 32) {
    throw new Error('Provider scope fingerprint key must contain at least 32 bytes');
  }
  if (typeof row.credential_generation !== 'string' || row.credential_generation.length === 0) {
    throw new Error('Persisted provider has no credential generation');
  }

  const tokenEndpoint = oauthEndpoint(row.oauth_token_url);
  const identity = {
    host: row.host,
    port: Number(row.port),
    secure: Boolean(row.secure ?? true),
    allowStarttls: Boolean(row.allow_starttls ?? false),
    username: row.username ?? null,
    authType: row.auth_type ?? null,
    oauthTokenUrl: row.oauth_token_url ?? null,
    oauthAuthorizeUrl: row.oauth_authorize_url ?? null,
    oauthClientId: row.oauth_client_id ?? null,
    oauthClientSecret: row.oauth_client_secret ?? null,
  };
  const updatedAt = new Date(row.updated_at).toISOString();
  const scopeFingerprint = createHmac('sha256', fingerprintKey)
    .update(JSON.stringify(identity))
    .digest('hex');

  return {
    database,
    providerId,
    host: identity.host,
    port: identity.port,
    authType: identity.authType,
    oauthClientId: identity.oauthClientId,
    oauthTokenProtocol: tokenEndpoint.protocol,
    oauthTokenHost: tokenEndpoint.host,
    oauthTokenPort: tokenEndpoint.port,
    credentialGeneration: row.credential_generation,
    scopeFingerprint,
    updatedAt,
    capturedAt,
  };
}
