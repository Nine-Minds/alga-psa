import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Private retry material. Keep this envelope out of run-history/API results. */
export type EncryptedActionReplay = {
  version: 1;
  keyId?: string;
  nonce: string;
  tag: string;
  ciphertext: string;
};
export type ActionReplayIdentity = { tenantId: string | null; invocationId: string };

function keyFromMaterial(material: string): Buffer {
  if (!material) throw new Error('Workflow replay encryption key is required');
  return createHash('sha256').update('alga-workflow-action-replay-v1\0').update(material).digest();
}
function authenticatedIdentity(identity: ActionReplayIdentity): Buffer {
  if (!identity.invocationId || (identity.tenantId !== null && !identity.tenantId)) {
    throw new Error('Workflow replay identity is required');
  }
  return Buffer.from(JSON.stringify(['workflow-action-replay', 1, identity.tenantId, identity.invocationId]), 'utf8');
}
function decodeBase64(value: unknown, expectedBytes?: number): Buffer {
  if (typeof value !== 'string') throw new Error('Invalid workflow replay envelope');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value || (expectedBytes !== undefined && decoded.length !== expectedBytes)) {
    throw new Error('Invalid workflow replay envelope');
  }
  return decoded;
}

export function encryptActionReplay(value: unknown, material: string, identity: ActionReplayIdentity): EncryptedActionReplay {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Workflow replay result must be JSON serializable');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromMaterial(material), nonce);
  cipher.setAAD(authenticatedIdentity(identity));
  const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  return { version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptActionReplay(envelope: unknown, material: string, identity: ActionReplayIdentity): unknown {
  const key = keyFromMaterial(material);
  const aad = authenticatedIdentity(identity);
  try {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error();
    const value = envelope as Record<string, unknown>;
    if (value.version !== 1) throw new Error();
    const nonce = decodeBase64(value.nonce, 12);
    const tag = decodeBase64(value.tag, 16);
    const ciphertext = decodeBase64(value.ciphertext);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  } catch {
    // Never echo protected material, keys or provider errors into diagnostics.
    throw new Error('Unable to authenticate workflow replay result');
  }
}
