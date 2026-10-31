import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDecipheriv, randomUUID, scryptSync } from 'node:crypto';

const { getSecret } = vi.hoisted(() => ({ getSecret: vi.fn() }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret }));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: vi.fn() } }));

import {
  encryptCredentialValues, resetCredentialAesKeyCache,
} from '../../../../../ee/server/src/lib/credentials/encryption';
import {
  PORTABLE_VAULT_KDF, sealPortableCredentialVault,
} from '../../../../../ee/server/src/lib/credentials/portable';

const passphrase = 'customer-held portable recovery phrase';
const originalEnvironment = { ...process.env };
// Restore keys in place rather than assigning a fresh object: replacing
// process.env swaps it out from under modules that captured the original
// reference (`import { env } from 'node:process'` keeps the old one), so a
// later file in the shared fork writes to one object and reads from another.
function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (process.env[key] !== value) process.env[key] = value;
  }
}

beforeEach(() => {
  for (const key of ['VAULT_ADDR', 'VAULT_TOKEN', 'ALGA_VAULT_ADDR', 'ALGA_VAULT_TOKEN']) delete process.env[key];
  getSecret.mockReset().mockResolvedValue('source-installation-only-key');
  resetCredentialAesKeyCache();
});
afterEach(() => {
  restoreEnvironment();
  resetCredentialAesKeyCache();
  vi.unstubAllGlobals();
});

async function fixture() {
  const context = { packageId: randomUUID(), sourceTenant: randomUUID() };
  const credentialId = randomUUID();
  const secret = { password: 'customer password to preserve', otpSecret: 'JBSWY3DPEHPK3PXP' };
  const stored = { credentialId, ...await encryptCredentialValues(secret) };
  const envelope = await sealPortableCredentialVault(context, [stored], passphrase);
  return { context, credentialId, secret, stored, envelope };
}

/** An independent reader: derives the key from the KDF parameters RECORDED in the envelope, not from module constants. */
function open(envelope: Awaited<ReturnType<typeof sealPortableCredentialVault>>, phrase: string) {
  const { N, r, p, keyBytes } = envelope.kdf;
  const key = scryptSync(Buffer.from(phrase, 'utf8'), Buffer.from(envelope.salt, 'base64'), keyBytes, { N, r, p, maxmem: 256 * 1024 * 1024 });
  const decipher = createDecipheriv(envelope.kdf.cipher as 'aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(JSON.stringify([envelope.format, envelope.packageId, envelope.sourceTenant]), 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

describe('co-managed portable customer vault (export side)', () => {
  it('never emits plaintext, and records KDF and cipher parameters that an independent reader can use', async () => {
    const f = await fixture();
    const serialized = JSON.stringify(f.envelope);
    for (const leaked of [f.secret.password, f.secret.otpSecret, f.stored.passwordCiphertext, passphrase]) expect(serialized).not.toContain(leaked);
    expect(f.envelope.kdf).toEqual(PORTABLE_VAULT_KDF);
    expect(f.envelope.kdf).toMatchObject({ name: 'scrypt', cipher: 'aes-256-gcm' });
    expect(open(f.envelope, passphrase)).toEqual([{ credentialId: f.credentialId, ...f.secret }]);
  });

  it('fails to open under tampering, substitution or a wrong passphrase', async () => {
    const f = await fixture();
    const changed = Buffer.from(f.envelope.ciphertext, 'base64'); changed[0] ^= 1;
    expect(() => open({ ...f.envelope, ciphertext: changed.toString('base64') }, passphrase)).toThrow();
    expect(() => open(f.envelope, 'a different recovery passphrase')).toThrow();
    expect(() => open({ ...f.envelope, packageId: randomUUID() }, passphrase)).toThrow();
  });

  it('rejects a short passphrase and fails closed if source decryption fails', async () => {
    const f = await fixture();
    await expect(sealPortableCredentialVault(f.context, [f.stored], 'short')).rejects.toThrow('cannot be unlocked');
    await expect(sealPortableCredentialVault(f.context, [{ ...f.stored, passwordCiphertext: 'broken' }], passphrase)).rejects.toThrow('cannot be unlocked');
  });
});
