import crypto from 'crypto';
import { getSecret } from '@alga-psa/core/secrets';

// LEVERAGE: pattern aes-256-gcm-secret-at-rest — same enc: envelope (12-byte IV +
// GCM auth tag + ciphertext, AES-256-GCM, key derived via SHA-256 of a dedicated
// app secret with NEXTAUTH_SECRET fallback) as CalendarProviderService.encryptValue
// and the credentials vault. Not shared: the calendar helper is a private class
// method and the vault key is managed under @enterprise, so the Xero routes keep a
// small local copy for the PKCE code_verifier.
//
// The Xero PKCE code_verifier is confidential (RFC 7636). It must never be
// sent through the browser, so the connect route stores it server-side in a
// short-lived attempt record. At rest it is encrypted with AES-256-GCM keyed
// on a dedicated app secret (XERO_OAUTH_VERIFIER_KEY) with NEXTAUTH_SECRET as
// the fallback, mirroring the calendar provider secret-encryption pattern.

const ENCRYPTED_PREFIX = 'enc:';

async function getVerifierEncryptionKey(): Promise<Buffer> {
  const configured = await getSecret('xero_oauth_verifier_key', 'XERO_OAUTH_VERIFIER_KEY');
  const keyMaterial = configured || process.env.NEXTAUTH_SECRET || '';
  if (!keyMaterial) {
    throw new Error(
      'Xero OAuth verifier encryption key is not configured. Set XERO_OAUTH_VERIFIER_KEY or NEXTAUTH_SECRET.'
    );
  }
  return crypto.createHash('sha256').update(keyMaterial).digest();
}

export async function encryptXeroVerifier(plainText: string): Promise<string> {
  if (!plainText) {
    return plainText;
  }

  const key = await getVerifierEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return `${ENCRYPTED_PREFIX}${payload}`;
}

export function isEncryptedXeroVerifier(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

export async function decryptXeroVerifier(value: string): Promise<string> {
  if (!isEncryptedXeroVerifier(value)) {
    throw new Error('Xero OAuth verifier record is not encrypted');
  }

  const payload = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
  if (payload.length < 28) {
    throw new Error('Encrypted Xero OAuth verifier payload is malformed');
  }

  const key = await getVerifierEncryptionKey();
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
