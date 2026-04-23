/**
 * Sign in with Apple — identity token verification, authorization code exchange,
 * and refresh token revocation.
 *
 * Secrets / config (via `getSecretProviderInstance`):
 *   - APPLE_SIGN_IN_BUNDLE_ID   iOS bundle identifier (e.g. com.nineminds.algapsa)
 *   - APPLE_SIGN_IN_TEAM_ID     Apple Developer team ID (10-char alphanumeric)
 *   - APPLE_SIGN_IN_KEY_ID      Sign-in key ID from the Apple Developer portal
 *   - APPLE_SIGN_IN_PRIVATE_KEY full contents of the .p8 private key (PEM)
 *
 * The bundle ID is the client_id / audience for identity tokens. The other
 * three are required only for authorization-code exchange and refresh-token
 * revocation (account-deletion flow).
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getSecret, getSecretProviderInstance } from '@alga-psa/core/secrets';

export type AppleIdentityPayload = {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  real_user_status?: number;
  nonce?: string;
  nonce_supported?: boolean;
};

export type AppleSignInConfig = {
  bundleId: string;
  teamId: string | null;
  keyId: string | null;
  privateKeyPem: string | null;
};

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = `${APPLE_ISSUER}/auth/keys`;
const APPLE_TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const APPLE_REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`;

// JWKS cache: Apple rotates keys infrequently. A short TTL keeps the cache
// simple while still limiting outbound calls under load.
const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache: { fetchedAt: number; keys: AppleJwk[] } | null = null;

type AppleJwk = {
  kty: 'RSA';
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
};

let cachedConfig: AppleSignInConfig | null = null;

export async function getAppleSignInConfig(): Promise<AppleSignInConfig> {
  if (cachedConfig) return cachedConfig;

  const provider = await getSecretProviderInstance();

  const [bundleId, teamId, keyId, privateKeyPem] = await Promise.all([
    provider.getAppSecret('APPLE_SIGN_IN_BUNDLE_ID'),
    provider.getAppSecret('APPLE_SIGN_IN_TEAM_ID').catch(() => null),
    provider.getAppSecret('APPLE_SIGN_IN_KEY_ID').catch(() => null),
    provider.getAppSecret('APPLE_SIGN_IN_PRIVATE_KEY').catch(() => null),
  ]);

  if (!bundleId) {
    throw new Error(
      'Sign in with Apple is not configured. Set APPLE_SIGN_IN_BUNDLE_ID.',
    );
  }

  cachedConfig = {
    bundleId,
    teamId: teamId ?? null,
    keyId: keyId ?? null,
    privateKeyPem: privateKeyPem ?? null,
  };
  return cachedConfig;
}

/** Test-only */
export function __resetAppleSignInConfigForTests(): void {
  cachedConfig = null;
  jwksCache = null;
}

async function fetchJwks(): Promise<AppleJwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(APPLE_JWKS_URL, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Failed to fetch Apple JWKS: ${res.status}`);
  }
  const body = (await res.json()) as { keys: AppleJwk[] };
  if (!body?.keys?.length) {
    throw new Error('Apple JWKS response missing keys');
  }
  jwksCache = { fetchedAt: Date.now(), keys: body.keys };
  return body.keys;
}

function jwkToPem(jwk: AppleJwk): string {
  const key = crypto.createPublicKey({ key: jwk as unknown as crypto.JsonWebKey, format: 'jwk' });
  return key.export({ type: 'spki', format: 'pem' }).toString();
}

/**
 * Verify an Apple-issued identity token and return its decoded payload.
 *
 * Apple identity tokens are RS256-signed JWTs with `kid` pointing at a key
 * published on APPLE_JWKS_URL. Checks iss, aud, exp; optional nonce check
 * is the caller's responsibility (we don't require it for the mobile flow
 * because the token is delivered natively and not through an open redirect).
 */
export async function verifyAppleIdentityToken(
  idToken: string,
  config?: AppleSignInConfig,
): Promise<AppleIdentityPayload> {
  const cfg = config ?? (await getAppleSignInConfig());
  const decodedHeader = jwt.decode(idToken, { complete: true });
  if (!decodedHeader || typeof decodedHeader === 'string') {
    throw new Error('Malformed Apple identity token');
  }
  const kid = decodedHeader.header?.kid;
  if (!kid) {
    throw new Error('Apple identity token missing kid');
  }

  const keys = await fetchJwks();
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    // Key rotation — bust the cache and try once more.
    jwksCache = null;
    const refreshed = await fetchJwks();
    const retryJwk = refreshed.find((k) => k.kid === kid);
    if (!retryJwk) {
      throw new Error(`Unknown Apple signing key: ${kid}`);
    }
    return verifyWithJwk(idToken, retryJwk, cfg.bundleId);
  }
  return verifyWithJwk(idToken, jwk, cfg.bundleId);
}

function verifyWithJwk(
  idToken: string,
  jwk: AppleJwk,
  bundleId: string,
): AppleIdentityPayload {
  const pem = jwkToPem(jwk);
  const verified = jwt.verify(idToken, pem, {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
    audience: bundleId,
  });
  if (typeof verified === 'string') {
    throw new Error('Apple identity token payload is not an object');
  }
  return verified as AppleIdentityPayload;
}

// ---------------- Server-to-server notifications ----------------
//
// Apple POSTs JSON of the form `{ payload: "<JWS>" }` to the S2S endpoint
// registered in the Apple Developer portal. The JWS is signed with the same
// keys as identity tokens; the inner JWT has an `events` claim whose value is
// a **JSON-encoded string** (not a nested object).

export type AppleServerNotificationEventType =
  | 'email-disabled'
  | 'email-enabled'
  | 'consent-revoked'
  | 'account-delete';

export type AppleServerNotificationEvent = {
  type: AppleServerNotificationEventType;
  sub: string;
  email?: string;
  is_private_email?: boolean | string;
  event_time: number;
};

export type AppleServerNotification = {
  iss: string;
  aud: string;
  iat: number;
  jti: string;
  events: AppleServerNotificationEvent;
};

type RawAppleNotificationJwt = {
  iss: string;
  aud: string;
  iat: number;
  jti: string;
  events: string;
};

/**
 * Verify an Apple server-to-server notification JWS and return the decoded
 * event. The `events` claim in the JWT body is itself a JSON-encoded string,
 * which we parse and validate.
 *
 * Throws on any of:
 *   - Malformed JWT / unknown kid / bad signature
 *   - Wrong issuer or audience
 *   - Missing / malformed inner events claim
 *   - Unknown event type (returned verbatim; caller decides whether to ignore)
 */
export async function verifyAppleServerNotification(
  jwsToken: string,
  config?: AppleSignInConfig,
): Promise<AppleServerNotification> {
  const cfg = config ?? (await getAppleSignInConfig());
  const decodedHeader = jwt.decode(jwsToken, { complete: true });
  if (!decodedHeader || typeof decodedHeader === 'string') {
    throw new Error('Malformed Apple server notification token');
  }
  const kid = decodedHeader.header?.kid;
  if (!kid) {
    throw new Error('Apple server notification token missing kid');
  }

  const keys = await fetchJwks();
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    jwksCache = null;
    const refreshed = await fetchJwks();
    jwk = refreshed.find((k) => k.kid === kid);
    if (!jwk) {
      throw new Error(`Unknown Apple signing key: ${kid}`);
    }
  }

  const pem = jwkToPem(jwk);
  const verified = jwt.verify(jwsToken, pem, {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
    audience: cfg.bundleId,
  });
  if (typeof verified === 'string' || !verified) {
    throw new Error('Apple server notification payload is not an object');
  }

  const raw = verified as RawAppleNotificationJwt;
  if (typeof raw.events !== 'string') {
    throw new Error('Apple server notification missing events claim');
  }

  let parsed: AppleServerNotificationEvent;
  try {
    parsed = JSON.parse(raw.events) as AppleServerNotificationEvent;
  } catch {
    throw new Error('Apple server notification events claim is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.type || !parsed.sub) {
    throw new Error('Apple server notification events payload is malformed');
  }

  return {
    iss: raw.iss,
    aud: raw.aud,
    iat: raw.iat,
    jti: raw.jti,
    events: parsed,
  };
}

// ---------------- Authorization code exchange ----------------

export type AppleTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
};

function buildClientSecret(cfg: AppleSignInConfig): string {
  if (!cfg.teamId || !cfg.keyId || !cfg.privateKeyPem) {
    throw new Error(
      'Apple Sign In client secret not configured. Set APPLE_SIGN_IN_TEAM_ID, APPLE_SIGN_IN_KEY_ID, APPLE_SIGN_IN_PRIVATE_KEY.',
    );
  }
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: cfg.teamId,
      iat: now,
      exp: now + 15 * 60,
      aud: APPLE_ISSUER,
      sub: cfg.bundleId,
    },
    cfg.privateKeyPem,
    {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: cfg.keyId,
        typ: 'JWT',
      },
    },
  );
}

/**
 * Exchange an Apple `authorizationCode` (returned alongside the identity token
 * from the native SIWA flow) for a refresh token. The refresh token is what
 * we store so account-deletion can revoke the grant.
 *
 * Returns null if the client-secret-signing key isn't configured — callers
 * can still sign the user in without the refresh token (deletion will just
 * skip the revoke step).
 */
export async function exchangeAppleAuthorizationCode(
  code: string,
  config?: AppleSignInConfig,
): Promise<AppleTokenResponse | null> {
  const cfg = config ?? (await getAppleSignInConfig());
  if (!cfg.teamId || !cfg.keyId || !cfg.privateKeyPem) {
    return null;
  }
  const clientSecret = buildClientSecret(cfg);

  const params = new URLSearchParams();
  params.set('client_id', cfg.bundleId);
  params.set('client_secret', clientSecret);
  params.set('code', code);
  params.set('grant_type', 'authorization_code');

  const res = await fetch(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apple token exchange failed: ${res.status} ${body}`);
  }
  return (await res.json()) as AppleTokenResponse;
}

/**
 * Revoke an Apple refresh token. Required by guideline 5.1.1(v) when the user
 * deletes their account.
 */
export async function revokeAppleRefreshToken(
  refreshToken: string,
  config?: AppleSignInConfig,
): Promise<void> {
  const cfg = config ?? (await getAppleSignInConfig());
  if (!cfg.teamId || !cfg.keyId || !cfg.privateKeyPem) {
    return;
  }
  const clientSecret = buildClientSecret(cfg);

  const params = new URLSearchParams();
  params.set('client_id', cfg.bundleId);
  params.set('client_secret', clientSecret);
  params.set('token', refreshToken);
  params.set('token_type_hint', 'refresh_token');

  const res = await fetch(APPLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Apple token revoke failed: ${res.status} ${body}`);
  }
}

// ---------------- Encryption of stored refresh tokens ----------------

let encryptionKeyPromise: Promise<Buffer> | null = null;

async function getEncryptionKey(): Promise<Buffer> {
  if (!encryptionKeyPromise) {
    encryptionKeyPromise = (async () => {
      const secret =
        (await getSecret('apple_sign_in_encryption_key', 'APPLE_SIGN_IN_ENCRYPTION_KEY', '').catch(() => '')) ||
        process.env.NEXTAUTH_SECRET ||
        '';
      if (!secret) {
        throw new Error(
          'Sign in with Apple encryption key is not configured. Set APPLE_SIGN_IN_ENCRYPTION_KEY or NEXTAUTH_SECRET.',
        );
      }
      return crypto.createHash('sha256').update(secret).digest();
    })();
  }
  return encryptionKeyPromise;
}

export async function encryptAppleRefreshToken(plainText: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return `enc:${payload}`;
}

export async function decryptAppleRefreshToken(value: string): Promise<string | null> {
  if (!value.startsWith('enc:')) return value;
  try {
    const key = await getEncryptionKey();
    const buffer = Buffer.from(value.slice(4), 'base64');
    if (buffer.length < 28) return null;
    const iv = buffer.subarray(0, 12);
    const authTag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}
