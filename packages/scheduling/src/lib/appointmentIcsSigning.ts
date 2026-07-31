import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createHmac, timingSafeEqual } from 'node:crypto';

// NOTE: this module must never be marked 'use server' — it handles the
// signing secret, and every export of a "use server" file becomes a
// client-reachable server action.

let cachedIcsSigningSecret: string | null = null;

/**
 * Secret for HMAC-signing appointment ICS download links (minted when the
 * appointment email is built, verified by the public ICS route). Sourced the
 * same way the auth/marketing stacks source it: NEXTAUTH_SECRET from env,
 * then the app secret provider. Returns null when unavailable — link
 * generation and the route both fail closed.
 */
export async function getAppointmentIcsSigningSecret(): Promise<string | null> {
  if (cachedIcsSigningSecret) return cachedIcsSigningSecret;
  const fromEnv = process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) {
    cachedIcsSigningSecret = fromEnv;
    return cachedIcsSigningSecret;
  }
  const secretProvider = await getSecretProviderInstance();
  const fromAppSecret = (await secretProvider.getAppSecret('NEXTAUTH_SECRET'))?.trim();
  if (fromAppSecret) {
    cachedIcsSigningSecret = fromAppSecret;
    return cachedIcsSigningSecret;
  }
  return null;
}

/**
 * HMAC signature binding an ICS download link to a specific schedule entry.
 * The public ICS route resolves the entry cross-tenant, so the token is what
 * proves the caller was handed the link (via an appointment email) rather
 * than guessing entry IDs. Follows the marketing click-tracking signing
 * pattern — pure, the caller supplies the secret.
 */
export async function signAppointmentIcsToken(secret: string, entryId: string): Promise<string> {
  return createHmac('sha256', secret)
    .update(`appointment-ics\n${entryId}`)
    .digest('hex');
}

export async function verifyAppointmentIcsToken(
  secret: string,
  entryId: string,
  token: string,
): Promise<boolean> {
  const expected = Buffer.from(await signAppointmentIcsToken(secret, entryId), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(token, 'hex');
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(expected, provided);
}
