import { createLocalJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { readBotCredentialsFromEnv } from './teamsBotConnector';

const BOT_FRAMEWORK_OPENID_URL =
  'https://login.botframework.com/v1/.well-known/openidconfiguration';
const BOT_FRAMEWORK_ISSUER = 'https://api.botframework.com';

interface OpenIdConfig {
  jwks_uri?: string;
  issuer?: string;
}

interface CachedJwksContext {
  jwks: ReturnType<typeof createLocalJWKSet>;
  issuer: string;
  refreshedAt: number;
}

const JWKS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let cachedContext: CachedJwksContext | null = null;
let inFlightConfigFetch: Promise<CachedJwksContext> | null = null;

export function resetTeamsBotJwksCacheForTests(): void {
  cachedContext = null;
  inFlightConfigFetch = null;
}

async function loadJwksContext(): Promise<CachedJwksContext> {
  if (cachedContext && Date.now() - cachedContext.refreshedAt < JWKS_CACHE_TTL_MS) {
    return cachedContext;
  }

  if (inFlightConfigFetch) {
    return inFlightConfigFetch;
  }

  inFlightConfigFetch = (async () => {
    const response = await fetch(BOT_FRAMEWORK_OPENID_URL);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Bot Framework OpenID config (${response.status} ${response.statusText})`
      );
    }
    const config = (await response.json()) as OpenIdConfig;
    if (!config.jwks_uri) {
      throw new Error('Bot Framework OpenID config did not include jwks_uri.');
    }
    const jwksResponse = await fetch(config.jwks_uri);
    if (!jwksResponse.ok) {
      throw new Error(
        `Failed to fetch Bot Framework JWKS (${jwksResponse.status} ${jwksResponse.statusText})`
      );
    }
    const jwks = createLocalJWKSet(await jwksResponse.json());
    const next: CachedJwksContext = {
      jwks,
      issuer: config.issuer || BOT_FRAMEWORK_ISSUER,
      refreshedAt: Date.now(),
    };
    cachedContext = next;
    return next;
  })().finally(() => {
    inFlightConfigFetch = null;
  });

  return inFlightConfigFetch;
}

export type TeamsBotVerificationResult =
  | { status: 'verified'; payload: JWTPayload }
  | { status: 'unconfigured' }
  | { status: 'rejected'; reason: string };

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : null;
}

export async function verifyTeamsBotRequest(
  authHeader: string | null
): Promise<TeamsBotVerificationResult> {
  const credentials = readBotCredentialsFromEnv();
  if (!credentials) {
    // Without bot credentials there is no audience to validate against, so no
    // inbound request can ever be verified. Callers must fail closed on this
    // status; processing unauthenticated activities is never acceptable.
    return { status: 'unconfigured' };
  }

  const token = extractBearer(authHeader);
  if (!token) {
    return { status: 'rejected', reason: 'missing_bearer_token' };
  }

  let context: CachedJwksContext;
  try {
    context = await loadJwksContext();
  } catch (err) {
    return {
      status: 'rejected',
      reason: `openid_config_fetch_failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }

  try {
    const { payload } = await jwtVerify(token, context.jwks, {
      issuer: context.issuer,
      audience: credentials.appId,
    });
    return { status: 'verified', payload };
  } catch (err) {
    return {
      status: 'rejected',
      reason: err instanceof Error ? err.message : 'invalid_token',
    };
  }
}
