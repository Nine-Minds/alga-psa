import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

// Stable for this emulator process, including resets: clients may cache JWKS.
let signingKey: { publicKey: KeyObject; privateKey: KeyObject } | undefined;
const kid = 'algasim-entra-oidc';
function key() {
  return signingKey ??= generateKeyPairSync('rsa', { modulusLength: 2048 });
}

export function entraJwks() {
  return { keys: [{ ...key().publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] };
}

/** One short-lived sign-in token: 5 minutes, never refreshed. */
export const ENTRA_ID_TOKEN_LIFETIME_SECONDS = 300;

export function signEntraIdToken(claims: Record<string, unknown>, nowSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encode({ alg: 'RS256', typ: 'JWT', kid })}.${encode({
    ...claims, iat: nowSeconds, nbf: nowSeconds - 5, exp: nowSeconds + ENTRA_ID_TOKEN_LIFETIME_SECONDS,
  })}`;
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), key().privateKey).toString('base64url')}`;
}
