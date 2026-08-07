import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/**
 * Bot Framework identity provider. The emulator is a real signer, not a
 * verification bypass: it publishes an OpenID config + JWKS and RS256-signs the
 * activities it injects, so the app's jose `createLocalJWKSet`/`jwtVerify` path
 * runs unmodified with full signature checking.
 */
export const BOT_FRAMEWORK_ISSUER = 'https://api.botframework.com';

interface SigningKey {
  privateKey: KeyObject;
  kid: string;
  jwk: Record<string, unknown>;
}

// One keypair per process, created on first use. It must never be replaced on
// reset(): the app caches the JWKS for 12h, so rotating it mid-run would make
// previously-issued tokens unverifiable.
let signingKey: SigningKey | null = null;

function key(): SigningKey {
  if (!signingKey) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = 'algasim-botframework-signing-key';
    signingKey = {
      privateKey,
      kid,
      jwk: { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid, use: 'sig', alg: 'RS256' },
    };
  }
  return signingKey;
}

export function botFrameworkJwks(): { keys: Array<Record<string, unknown>> } {
  return { keys: [key().jwk] };
}

export interface BotFrameworkClaims {
  aud: string;
  serviceurl: string;
  oid?: string;
  tid?: string;
}

/**
 * Sign an inbound Bot Framework token. `issuedAtSeconds` comes from the host
 * clock so `algasim clock advance` ages tokens; `nbf` is backdated slightly so
 * a virtual clock nudged ahead of wall time still yields an active token.
 */
export function signBotFrameworkJwt(
  claims: BotFrameworkClaims,
  issuedAtSeconds: number,
  ttlSeconds = 3600,
): string {
  const { privateKey, kid } = key();
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = base64url(
    JSON.stringify({
      ...claims,
      iss: BOT_FRAMEWORK_ISSUER,
      iat: issuedAtSeconds,
      nbf: issuedAtSeconds - 300,
      exp: issuedAtSeconds + ttlSeconds,
    }),
  );
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')}`;
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}
