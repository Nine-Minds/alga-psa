import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const { getSecret } = vi.hoisted(() => ({ getSecret: vi.fn() }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret }));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: vi.fn() } }));

import {
  decryptCredentialValue, encryptCredentialValues, resetCredentialAesKeyCache,
} from '../../../../../ee/server/src/lib/credentials/encryption';
import {
  restorePortableCredentialVault, sealPortableCredentialVault,
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

describe('co-managed portable customer vault', () => {
  it('restores usable passwords and OTP seeds with a new installation key after the source key is gone', async () => {
    const f = await fixture();
    const serialized = JSON.stringify(f.envelope);
    expect(serialized).not.toContain(f.secret.password);
    expect(serialized).not.toContain(f.secret.otpSecret);
    expect(serialized).not.toContain(f.stored.passwordCiphertext);
    expect(serialized).not.toContain(passphrase);

    getSecret.mockResolvedValue('destination-installation-only-key');
    resetCredentialAesKeyCache();
    await expect(decryptCredentialValue(f.stored.passwordCiphertext, f.stored.scheme)).rejects.toThrow();
    const restored = await restorePortableCredentialVault(JSON.parse(serialized), f.context, [f.credentialId], passphrase);
    expect(restored).toHaveLength(1);
    expect(restored[0].credentialId).toBe(f.credentialId);
    expect(restored[0].passwordCiphertext).not.toBe(f.stored.passwordCiphertext);
    await expect(decryptCredentialValue(restored[0].passwordCiphertext, restored[0].scheme)).resolves.toBe(f.secret.password);
    await expect(decryptCredentialValue(restored[0].otpSecretCiphertext, restored[0].scheme)).resolves.toBe(f.secret.otpSecret);
  });

  it('rejects tampering, substitution, wrong membership and wrong passphrases before any destination vault call', async () => {
    const f = await fixture();
    process.env.ALGA_VAULT_ADDR = 'https://destination-vault.example.test';
    process.env.ALGA_VAULT_TOKEN = 'destination-test-token';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const changed = Buffer.from(f.envelope.ciphertext, 'base64');
    changed[0] ^= 1;
    await expect(restorePortableCredentialVault({ ...f.envelope, ciphertext: changed.toString('base64') }, f.context, [f.credentialId], passphrase)).rejects.toThrow('cannot be unlocked');
    await expect(restorePortableCredentialVault(f.envelope, f.context, [f.credentialId], 'a different recovery passphrase')).rejects.toThrow('cannot be unlocked');
    await expect(restorePortableCredentialVault(f.envelope, f.context, [randomUUID()], passphrase)).rejects.toThrow('cannot be unlocked');
    const otherContext = { ...f.context, packageId: randomUUID() };
    // Even rewriting both public metadata and expected context cannot transplant the ciphertext.
    await expect(restorePortableCredentialVault({ ...f.envelope, ...otherContext }, otherContext, [f.credentialId], passphrase)).rejects.toThrow('cannot be unlocked');
    await expect(restorePortableCredentialVault({ ...f.envelope, salt: 'AA==' }, f.context, [f.credentialId], passphrase)).rejects.toThrow('cannot be unlocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the destination Transit write scheme and fails closed if source decryption or destination encryption fails', async () => {
    const f = await fixture();
    process.env.ALGA_VAULT_ADDR = 'https://destination-vault.example.test';
    process.env.ALGA_VAULT_TOKEN = 'destination-test-token';
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { ciphertext: 'vault:v1:destination-ciphertext' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const restored = await restorePortableCredentialVault(f.envelope, f.context, [f.credentialId], passphrase);
    expect(restored[0]).toEqual({ credentialId: f.credentialId, scheme: 'vault-transit:v1', passwordCiphertext: 'vault:v1:destination-ciphertext', otpSecretCiphertext: 'vault:v1:destination-ciphertext' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, request] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).toBe('https://destination-vault.example.test/v1/transit/encrypt/alga-credentials');
      expect(request.headers).toMatchObject({ 'x-vault-token': 'destination-test-token' });
    }
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as never);
    await expect(restorePortableCredentialVault(f.envelope, f.context, [f.credentialId], passphrase)).rejects.toThrow('cannot be unlocked');
    await expect(sealPortableCredentialVault(f.context, [{ ...f.stored, passwordCiphertext: 'broken' }], passphrase)).rejects.toThrow('cannot be unlocked');
  });
});
