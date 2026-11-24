import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

const STATE_TTL_MS = 10 * 60 * 1000;
const PURPOSE = 'imap-oauth';

export interface ImapOAuthState {
  tenant: string;
  userId: string;
  providerId: string;
  redirectUri: string;
  purpose: typeof PURPOSE;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

async function getSigningKey(): Promise<string> {
  const secretProvider = await getSecretProviderInstance();
  const key = process.env.NEXTAUTH_SECRET ||
    await secretProvider.getAppSecret('NEXTAUTH_SECRET') ||
    await secretProvider.getAppSecret('nextauth_secret');
  if (!key) throw new Error('IMAP OAuth state signing key is not configured');
  return key;
}

function signature(payload: string, key: string): Buffer {
  return createHmac('sha256', key).update(`imap-oauth-state:v1:${payload}`).digest();
}

export async function createImapOAuthState(input: {
  tenant: string;
  userId: string;
  providerId: string;
  redirectUri: string;
  now?: number;
}): Promise<{ state: ImapOAuthState; token: string }> {
  const issuedAt = input.now ?? Date.now();
  const { now: _now, ...bindings } = input;
  const state: ImapOAuthState = {
    ...bindings,
    purpose: PURPOSE,
    issuedAt,
    expiresAt: issuedAt + STATE_TTL_MS,
    nonce: randomBytes(32).toString('base64url'),
  };
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  const token = `${payload}.${signature(payload, await getSigningKey()).toString('base64url')}`;
  return { state, token };
}

export async function verifyImapOAuthState(token: string, now = Date.now()): Promise<ImapOAuthState | null> {
  try {
    const [payload, encodedSignature, extra] = token.split('.');
    if (!payload || !encodedSignature || extra !== undefined) return null;
    const expected = signature(payload, await getSigningKey());
    const supplied = Buffer.from(encodedSignature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ImapOAuthState;
    if (state.purpose !== PURPOSE || !state.tenant || !state.userId || !state.providerId ||
      !state.redirectUri || !state.nonce || !Number.isSafeInteger(state.issuedAt) ||
      !Number.isSafeInteger(state.expiresAt) || state.issuedAt > now || state.expiresAt <= now ||
      state.expiresAt - state.issuedAt !== STATE_TTL_MS) return null;
    return state;
  } catch {
    return null;
  }
}
