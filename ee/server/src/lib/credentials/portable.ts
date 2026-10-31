import { createCipheriv, randomBytes, scrypt } from 'node:crypto';
import { assertPortableTransferActive, awaitPortableTransfer } from '../../../../../packages/co-managed/src/portableTransfer';
import {
  decryptCredentialValue, encryptCredentialValues, isCredentialEncryptionScheme,
  type EncryptedCredentialValues,
} from './encryption';

const FORMAT = 'alga-credential-vault:scrypt-aes-256-gcm:v1';
/** Recorded in the manifest so a reader never has to infer how the envelope was derived. */
export const PORTABLE_VAULT_KDF = Object.freeze({ name: 'scrypt', N: 131072, r: 8, p: 1, keyBytes: 32, cipher: 'aes-256-gcm' });
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PortableCredentialContext {
  packageId: string;
  sourceTenant: string;
}

export interface PortableCredentialVault extends PortableCredentialContext {
  format: typeof FORMAT;
  kdf: typeof PORTABLE_VAULT_KDF;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface StoredPortableCredential extends EncryptedCredentialValues {
  credentialId: string;
}

interface PlainCredential {
  credentialId: string;
  password: string | null;
  otpSecret: string | null;
}

function invalid(): never {
  // Never include caller data, provider errors, or secret values in this error.
  throw new Error('Portable credential vault is invalid or cannot be unlocked.');
}

function contextCopy(context: PortableCredentialContext): PortableCredentialContext {
  if (!context || typeof context.packageId !== 'string' || typeof context.sourceTenant !== 'string' ||
      !UUID.test(context.packageId) || !UUID.test(context.sourceTenant)) invalid();
  return { packageId: context.packageId, sourceTenant: context.sourceTenant };
}

function associatedData(context: PortableCredentialContext): Buffer {
  return Buffer.from(JSON.stringify([FORMAT, context.packageId, context.sourceTenant]), 'utf8');
}

function passphraseBytes(passphrase: string): Buffer {
  if (typeof passphrase !== 'string') invalid();
  const length = Buffer.byteLength(passphrase, 'utf8');
  if (length < 16 || length > 1024) invalid();
  // Preserve the exact passphrase; no trimming or Unicode normalization.
  return Buffer.from(passphrase, 'utf8');
}

async function deriveKey(password: Buffer, salt: Buffer): Promise<Buffer> {
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      // Fixed v1 parameters: untrusted packages cannot choose KDF cost.
      scrypt(password, salt, PORTABLE_VAULT_KDF.keyBytes, { N: PORTABLE_VAULT_KDF.N, r: PORTABLE_VAULT_KDF.r, p: PORTABLE_VAULT_KDF.p, maxmem: 256 * 1024 * 1024 },
        (error, key) => error ? reject(error) : resolve(key));
    });
  } finally {
    password.fill(0);
  }
}

function validateIds(ids: readonly string[]): void {
  if (!Array.isArray(ids) || ids.length > MAX_RECORDS || ids.some(id => typeof id !== 'string' || !UUID.test(id)) ||
      new Set(ids).size !== ids.length) invalid();
}

/**
 * Internal export primitive, not an authorization boundary. The caller must
 * supply only the customer's authorized native vault rows, record reveal
 * audits, and recheck export authority before releasing the package. Metadata,
 * ACLs and associations belong in the enclosing workspace manifest.
 *
 * Source ciphertext is decrypted through the existing Transit/AES dispatcher;
 * only this passphrase envelope leaves the installation. Neither the passphrase
 * nor plaintext values may be persisted in jobs, logs, or workflow history.
 */
export async function sealPortableCredentialVault(
  context: PortableCredentialContext,
  records: readonly StoredPortableCredential[],
  passphrase: string,
): Promise<PortableCredentialVault> {
  const bound = contextCopy(context);
  if (!Array.isArray(records) || records.length > MAX_RECORDS) invalid();
  const snapshot = records.map(row => ({ ...row }));
  validateIds(snapshot.map(row => row.credentialId));
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphraseBytes(passphrase), salt);
  let plaintext: Buffer | undefined;
  try {
    const values: PlainCredential[] = [];
    let size = 2;
    for (const row of snapshot) {
      assertPortableTransferActive();
      if (!isCredentialEncryptionScheme(row.scheme)) invalid();
      const value = {
        credentialId: row.credentialId,
        password: await awaitPortableTransfer(() => decryptCredentialValue(row.passwordCiphertext, row.scheme)),
        otpSecret: await awaitPortableTransfer(() => decryptCredentialValue(row.otpSecretCiphertext, row.scheme)),
      };
      size += Buffer.byteLength(JSON.stringify(value), 'utf8') + 1;
      if (size > MAX_BYTES) invalid();
      values.push(value);
    }
    plaintext = Buffer.from(JSON.stringify(values), 'utf8');
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(associatedData(bound));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      format: FORMAT, kdf: PORTABLE_VAULT_KDF, ...bound, salt: salt.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
    };
  } catch {
    return invalid();
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}
