import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: async (_secretName: string, _envVar: string) =>
    process.env.XERO_OAUTH_VERIFIER_KEY || 'test-verifier-key',
}));

import {
  decryptXeroVerifier,
  encryptXeroVerifier,
  isEncryptedXeroVerifier,
} from './xeroOAuthVerifierCipher';

describe('Xero OAuth verifier cipher', () => {
  beforeEach(() => {
    delete process.env.XERO_OAUTH_VERIFIER_KEY;
  });

  it('round-trips a verifier and never emits identical ciphertexts', async () => {
    const verifier = 'opaque-verifier-material-1234567890';

    const enc1 = await encryptXeroVerifier(verifier);
    const enc2 = await encryptXeroVerifier(verifier);

    expect(isEncryptedXeroVerifier(enc1)).toBe(true);
    expect(isEncryptedXeroVerifier(enc2)).toBe(true);
    expect(enc1).not.toBe(enc2);
    expect(await decryptXeroVerifier(enc1)).toBe(verifier);
    expect(await decryptXeroVerifier(enc2)).toBe(verifier);
  });

  it('rejects a tampered ciphertext', async () => {
    const enc = await encryptXeroVerifier('verifier-value');
    const tampered = enc.slice(0, -4) + 'AAAA';

    await expect(decryptXeroVerifier(tampered)).rejects.toThrow();
  });

  it('rejects a plaintext record (never stored unencrypted)', async () => {
    await expect(decryptXeroVerifier('plain-verifier')).rejects.toThrow();
  });

  it('rejects a malformed encrypted payload', async () => {
    await expect(decryptXeroVerifier('enc:AAAA')).rejects.toThrow();
  });
});
