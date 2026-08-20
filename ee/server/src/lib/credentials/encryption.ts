/**
 * Envelope encryption for the credentials vault (EE-only).
 *
 * Two schemes, chosen per write and tagged per row:
 *
 *  - `vault-transit:v1` — Vault Transit (hosted EE). Follows the
 *    installConfig.ts precedent (raw fetch against the Transit HTTP API);
 *    credentials use a dedicated key name
 *    `ALGA_VAULT_CREDENTIALS_TRANSIT_KEY` (default `alga-credentials`).
 *  - `aes-256-gcm:v1` — AES-256-GCM with a key derived (SHA-256) from
 *    `getSecret('credential_encryption_key', 'CREDENTIAL_ENCRYPTION_KEY')`.
 *    Ciphertext format `enc:{base64(iv(12) + authTag(16) + ciphertext)}` —
 *    the exact CalendarProviderService precedent.
 *
 * SECURITY: there is deliberately NO plaintext/base64 scheme and NO fallback
 * to NEXTAUTH_SECRET. If neither scheme can be used (no transit config and no
 * AES key), writes fail with a clear operator error. Decryption dispatches on
 * the stored row tag and is fail-closed: any tampering / auth-tag mismatch /
 * malformed payload throws — the value is never returned.
 */

import crypto from 'node:crypto';
import logger from '@alga-psa/core/logger';
import { getSecret } from '@alga-psa/core/secrets';

export const CREDENTIAL_SCHEME_VAULT_TRANSIT = 'vault-transit:v1';
export const CREDENTIAL_SCHEME_AES_GCM = 'aes-256-gcm:v1';

export type CredentialEncryptionScheme = typeof CREDENTIAL_SCHEME_VAULT_TRANSIT | typeof CREDENTIAL_SCHEME_AES_GCM;

export const CREDENTIAL_ENCRYPTION_SCHEMES: readonly CredentialEncryptionScheme[] = [
  CREDENTIAL_SCHEME_VAULT_TRANSIT,
  CREDENTIAL_SCHEME_AES_GCM,
];

export function isCredentialEncryptionScheme(value: string): value is CredentialEncryptionScheme {
  return (CREDENTIAL_ENCRYPTION_SCHEMES as readonly string[]).includes(value);
}

export interface CredentialValueSet {
  /** Plaintext password; may be null on an OTP-only row. */
  password: string | null;
  /** Plaintext TOTP seed; may be null. */
  otpSecret: string | null;
}

export interface EncryptedCredentialValues {
  passwordCiphertext: string | null;
  otpSecretCiphertext: string | null;
  scheme: CredentialEncryptionScheme;
}

const TRANSIT_MOUNT_DEFAULT = 'transit';
const TRANSIT_KEY_DEFAULT = 'alga-credentials';

export interface TransitConfig {
  addr: string;
  token: string;
  key: string;
  mount: string;
  namespace?: string;
}

export function resolveTransitConfig(): TransitConfig | null {
  const addr = process.env.ALGA_VAULT_ADDR || process.env.VAULT_ADDR;
  const token = process.env.ALGA_VAULT_TOKEN || process.env.VAULT_TOKEN;
  if (!addr || !token) {
    return null;
  }
  const key = process.env.ALGA_VAULT_CREDENTIALS_TRANSIT_KEY || TRANSIT_KEY_DEFAULT;
  const mount = process.env.ALGA_VAULT_TRANSIT_MOUNT || TRANSIT_MOUNT_DEFAULT;
  const namespace = process.env.ALGA_VAULT_NAMESPACE || process.env.VAULT_NAMESPACE;
  return { addr, token, key, mount, namespace: namespace || undefined };
}

/** Write-scheme selection: Vault Transit when configured, else AES-256-GCM. */
export function schemeForNewWrites(): CredentialEncryptionScheme {
  return resolveTransitConfig() ? CREDENTIAL_SCHEME_VAULT_TRANSIT : CREDENTIAL_SCHEME_AES_GCM;
}

export function isVaultTransitConfigured(): boolean {
  return resolveTransitConfig() !== null;
}

// ============ Vault Transit ============

function transitUrl(cfg: TransitConfig, operation: 'encrypt' | 'decrypt'): string {
  const addr = cfg.addr.replace(/\/+$/, '');
  const mount = cfg.mount.replace(/^\/|\/$/g, '');
  const key = cfg.key.replace(/^\/|\/$/g, '');
  return `${addr}/v1/${mount}/${operation}/${key}`;
}

function transitHeaders(cfg: TransitConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-vault-token': cfg.token,
  };
  if (cfg.namespace) {
    headers['x-vault-namespace'] = cfg.namespace;
  }
  return headers;
}

async function encryptWithVault(plaintext: string, cfg: TransitConfig): Promise<string> {
  const url = transitUrl(cfg, 'encrypt');
  const resp = await fetch(url, {
    method: 'POST',
    headers: transitHeaders(cfg),
    body: JSON.stringify({ plaintext: Buffer.from(plaintext, 'utf8').toString('base64') }),
  });
  if (!resp.ok) {
    throw new Error(`Vault Transit encrypt failed (HTTP ${resp.status}); check VAULT_ADDR/VAULT_TOKEN and that the transit key "${cfg.key}" exists.`);
  }
  const data = (await resp.json()) as { data?: { ciphertext?: unknown } };
  const ciphertext = data?.data?.ciphertext;
  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    throw new Error('Vault Transit encrypt returned no ciphertext.');
  }
  return ciphertext;
}

async function decryptWithVault(ciphertext: string, cfg: TransitConfig): Promise<string> {
  const url = transitUrl(cfg, 'decrypt');
  const resp = await fetch(url, {
    method: 'POST',
    headers: transitHeaders(cfg),
    body: JSON.stringify({ ciphertext }),
  });
  if (!resp.ok) {
    throw new Error(`Vault Transit decrypt failed (HTTP ${resp.status}).`);
  }
  const data = (await resp.json()) as { data?: { plaintext?: unknown } };
  const plaintextB64 = data?.data?.plaintext;
  if (typeof plaintextB64 !== 'string' || plaintextB64.length === 0) {
    throw new Error('Vault Transit decrypt returned no plaintext.');
  }
  return Buffer.from(plaintextB64, 'base64').toString('utf8');
}

// ============ AES-256-GCM ============

let aesKeyPromise: Promise<Buffer> | null = null;

async function getAesKey(): Promise<Buffer> {
  if (!aesKeyPromise) {
    aesKeyPromise = (async () => {
      const secret = await getSecret('credential_encryption_key', 'CREDENTIAL_ENCRYPTION_KEY');
      if (!secret) {
        throw new Error(
          'Credential vault encryption key is not configured. Set CREDENTIAL_ENCRYPTION_KEY ' +
            '(or provision the `credential_encryption_key` secret) or configure Vault Transit. ' +
            'There is deliberately no fallback to NEXTAUTH_SECRET for credentials.'
        );
      }
      return crypto.createHash('sha256').update(secret).digest();
    })();
  }
  return aesKeyPromise;
}

/** Reset the cached AES key — test hook and a re-provisioning backstop. */
export function resetCredentialAesKeyCache(): void {
  aesKeyPromise = null;
}

/** Pure AES-256-GCM encrypt; payload layout `enc:{b64(iv(12)+tag(16)+ct)}`. */
export function encryptAesGcm(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return `enc:${payload}`;
}

/** Pure AES-256-GCM decrypt; fail-closed on malformed/tampered payloads. */
export function decryptAesGcm(value: string, key: Buffer): string {
  if (!value.startsWith('enc:')) {
    throw new Error('Unsupported ciphertext format for aes-256-gcm:v1.');
  }
  const buffer = Buffer.from(value.slice(4), 'base64');
  if (buffer.length < 28) {
    throw new Error('Encrypted credential payload is malformed.');
  }
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const ciphertext = buffer.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ============ Public API ============

/** Encrypt a value set (password and/or TOTP seed) with the write scheme. */
export async function encryptCredentialValues(values: CredentialValueSet): Promise<EncryptedCredentialValues> {
  const { password, otpSecret } = values;
  if (!password && !otpSecret) {
    return { passwordCiphertext: null, otpSecretCiphertext: null, scheme: schemeForNewWrites() };
  }

  const scheme = schemeForNewWrites();
  if (scheme === CREDENTIAL_SCHEME_VAULT_TRANSIT) {
    const cfg = resolveTransitConfig();
    if (!cfg) {
      throw new Error('Vault Transit scheme selected but transit is not configured.');
    }
    const [passwordCiphertext, otpSecretCiphertext] = await Promise.all([
      password ? encryptWithVault(password, cfg) : Promise.resolve(null),
      otpSecret ? encryptWithVault(otpSecret, cfg) : Promise.resolve(null),
    ]);
    return { passwordCiphertext, otpSecretCiphertext, scheme };
  }

  const key = await getAesKey();
  return {
    passwordCiphertext: password ? encryptAesGcm(password, key) : null,
    otpSecretCiphertext: otpSecret ? encryptAesGcm(otpSecret, key) : null,
    scheme,
  };
}

/**
 * Decrypt a single value, dispatching on the stored row tag. Fail-closed:
 * unknown scheme, missing config, or tampered payload all throw.
 */
export async function decryptCredentialValue(
  ciphertext: string | null,
  scheme: CredentialEncryptionScheme
): Promise<string | null> {
  if (!ciphertext) {
    return null;
  }
  if (scheme === CREDENTIAL_SCHEME_VAULT_TRANSIT) {
    const cfg = resolveTransitConfig();
    if (!cfg) {
      throw new Error('Cannot decrypt vault-transit:v1 credential: Vault Transit is not configured.');
    }
    try {
      return await decryptWithVault(ciphertext, cfg);
    } catch (error) {
      logger.error('[Credentials] vault-transit decrypt failed', { message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
  if (scheme === CREDENTIAL_SCHEME_AES_GCM) {
    const key = await getAesKey();
    return decryptAesGcm(ciphertext, key);
  }
  throw new Error(`Unknown credential encryption scheme: ${String(scheme)}`);
}
