import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getSecret } from '@alga-psa/core/secrets';

export interface NativeInteractionPosition {
  interaction_date: Date | string | null;
  interaction_id: string;
}

const TOKEN_VERSION = 'v1';

async function encryptionKey(): Promise<Buffer> {
  const secret = await getSecret('native_interaction_cursor_encryption_key', 'NEXTAUTH_SECRET');
  if (!secret) throw new Error('Interaction continuation encryption secret is not configured');
  return createHash('sha256').update('co-managed-native-interaction-cursor\0').update(secret).digest();
}

function associatedData(tenant: string, scope: string): Buffer {
  return Buffer.from(`${tenant}\0${scope}`, 'utf8');
}

/** Encrypts the internal keyset position. The browser only receives random-looking authenticated ciphertext. */
export async function sealNativeInteractionCursor(position: NativeInteractionPosition, tenant: string, scope: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await encryptionKey(), iv);
  cipher.setAAD(associatedData(tenant, scope));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({
    interaction_id: position.interaction_id,
    interaction_date: position.interaction_date == null ? null : new Date(position.interaction_date).toISOString(),
  }), 'utf8'), cipher.final()]);
  return [TOKEN_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

/** Rejects tampered, malformed, cross-tenant, and cross-query continuations. */
export async function openNativeInteractionCursor(token: string, tenant: string, scope: string): Promise<NativeInteractionPosition> {
  try {
    if (typeof token !== 'string' || token.length > 2048) throw new Error('invalid token');
    const [version, ivText, tagText, payloadText, extra] = token.split('.');
    if (version !== TOKEN_VERSION || !ivText || !tagText || !payloadText || extra !== undefined) throw new Error('invalid token');
    const iv = Buffer.from(ivText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    const payload = Buffer.from(payloadText, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || payload.length === 0) throw new Error('invalid token');
    const decipher = createDecipheriv('aes-256-gcm', await encryptionKey(), iv);
    decipher.setAAD(associatedData(tenant, scope));
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
    const value: unknown = JSON.parse(decoded);
    if (!value || typeof value !== 'object') throw new Error('invalid payload');
    const cursor = value as Record<string, unknown>;
    if (typeof cursor.interaction_id !== 'string' || !cursor.interaction_id ||
        !(cursor.interaction_date === null || typeof cursor.interaction_date === 'string') ||
        (typeof cursor.interaction_date === 'string' && !Number.isFinite(Date.parse(cursor.interaction_date)))) throw new Error('invalid payload');
    return { interaction_id: cursor.interaction_id,
      interaction_date: cursor.interaction_date as string | null };
  } catch {
    throw new Error('Invalid interaction continuation');
  }
}
