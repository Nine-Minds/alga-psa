import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSecretMock } = vi.hoisted(() => ({
  getSecretMock: vi.fn(async () => 'test-credential-encryption-key-12345'),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: getSecretMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  CREDENTIAL_SCHEME_AES_GCM,
  CREDENTIAL_SCHEME_VAULT_TRANSIT,
  decryptCredentialValue,
  encryptAesGcm,
  decryptAesGcm,
  encryptCredentialValues,
  isCredentialEncryptionScheme,
  resetCredentialAesKeyCache,
  schemeForNewWrites,
} from '@ee/lib/credentials/encryption';

const REAL_ENV = { ...process.env };

beforeEach(() => {
  resetCredentialAesKeyCache();
  getSecretMock.mockReset();
  getSecretMock.mockResolvedValue('test-credential-encryption-key-12345');
});

afterEach(() => {
  process.env = { ...REAL_ENV };
  vi.restoreAllMocks();
});

describe('credential encryption — scheme selection', () => {
  it('selects aes-256-gcm:v1 when Vault Transit is not configured', () => {
    delete process.env.ALGA_VAULT_ADDR;
    delete process.env.VAULT_ADDR;
    expect(schemeForNewWrites()).toBe(CREDENTIAL_SCHEME_AES_GCM);
  });

  it('selects vault-transit:v1 when Vault Transit is configured', () => {
    process.env.ALGA_VAULT_ADDR = 'https://vault.example.test';
    process.env.ALGA_VAULT_TOKEN = 'token';
    expect(schemeForNewWrites()).toBe(CREDENTIAL_SCHEME_VAULT_TRANSIT);
  });

  it('recognizes exactly the closed scheme roster', () => {
    expect(isCredentialEncryptionScheme(CREDENTIAL_SCHEME_AES_GCM)).toBe(true);
    expect(isCredentialEncryptionScheme(CREDENTIAL_SCHEME_VAULT_TRANSIT)).toBe(true);
    expect(isCredentialEncryptionScheme('inline/base64')).toBe(false);
    expect(isCredentialEncryptionScheme('plain')).toBe(false);
  });
});

describe('credential encryption — AES-256-GCM round-trip', () => {
  it('round-trips password and OTP seed and tags the row aes-256-gcm:v1', async () => {
    delete process.env.ALGA_VAULT_ADDR;
    delete process.env.VAULT_ADDR;

    const { passwordCiphertext, otpSecretCiphertext, scheme } = await encryptCredentialValues({
      password: 'S3cret!pass',
      otpSecret: 'GEZDGNBVGY3TQOJQ',
    });

    expect(scheme).toBe(CREDENTIAL_SCHEME_AES_GCM);
    expect(passwordCiphertext).toMatch(/^enc:/);
    expect(otpSecretCiphertext).toMatch(/^enc:/);
    expect(passwordCiphertext).not.toContain('S3cret!pass');

    await expect(decryptCredentialValue(passwordCiphertext, scheme)).resolves.toBe('S3cret!pass');
    await expect(decryptCredentialValue(otpSecretCiphertext, scheme)).resolves.toBe('GEZDGNBVGY3TQOJQ');
  });

  it('returns null ciphertexts for an empty value set but still tags a scheme', async () => {
    delete process.env.ALGA_VAULT_ADDR;
    const result = await encryptCredentialValues({ password: null, otpSecret: null });
    expect(result).toEqual({ passwordCiphertext: null, otpSecretCiphertext: null, scheme: CREDENTIAL_SCHEME_AES_GCM });
  });

  it('pure encrypt/decrypt round-trips and survives a null input as null', async () => {
    const key = Buffer.from('k'.repeat(32));
    const ciphertext = encryptAesGcm('hunter2', key);
    expect(decryptAesGcm(ciphertext, key)).toBe('hunter2');
    await expect(decryptCredentialValue(null, CREDENTIAL_SCHEME_AES_GCM)).resolves.toBeNull();
  });

  it('throws on a tampered ciphertext (auth-tag failure)', async () => {
    const key = Buffer.from('k'.repeat(32));
    const ciphertext = encryptAesGcm('hunter2', key);
    const flipped = ciphertext.slice(0, 12) + (ciphertext[12] === 'a' ? 'b' : 'a') + ciphertext.slice(13);
    expect(() => decryptAesGcm(flipped, key)).toThrow();
  });

  it('throws on a malformed ciphertext payload', async () => {
    const key = Buffer.from('k'.repeat(32));
    expect(() => decryptAesGcm('enc:AAAA', key)).toThrow(/malformed/);
    expect(() => decryptAesGcm('not-an-envelope', key)).toThrow(/format/);
  });

  it('throws a clear operator error when the key is missing (no NEXTAUTH_SECRET fallback)', async () => {
    delete process.env.ALGA_VAULT_ADDR;
    delete process.env.VAULT_ADDR;
    process.env.NEXTAUTH_SECRET = 'present-but-forbidden-fallback';
    getSecretMock.mockResolvedValue('');

    await expect(
      encryptCredentialValues({ password: 'x', otpSecret: null })
    ).rejects.toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
  });
});

describe('credential encryption — Vault Transit round-trip (mocked HTTP)', () => {
  it('encrypts/decrypts via the Transit API and tags the row vault-transit:v1', async () => {
    process.env.ALGA_VAULT_ADDR = 'https://vault.example.test';
    process.env.ALGA_VAULT_TOKEN = 'vault-token';
    process.env.ALGA_VAULT_CREDENTIALS_TRANSIT_KEY = 'alga-credentials-test';

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
      if (String(url).includes('/encrypt/')) {
        const plaintext = Buffer.from(body.plaintext as string, 'base64').toString('utf8');
        return new Response(
          JSON.stringify({ data: { ciphertext: `vault:v1:${Buffer.from(plaintext, 'utf8').toString('base64')}` } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (String(url).includes('/decrypt/')) {
        const ciphertext = String(body.ciphertext ?? '');
        const plaintext = Buffer.from(ciphertext.replace(/^vault:v1:/, ''), 'base64').toString('utf8');
        return new Response(
          JSON.stringify({ data: { plaintext: Buffer.from(plaintext, 'utf8').toString('base64') } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { passwordCiphertext, otpSecretCiphertext, scheme } = await encryptCredentialValues({
      password: 'vault-pass',
      otpSecret: 'JBSWY3DPEHPK3PXP',
    });

    expect(scheme).toBe(CREDENTIAL_SCHEME_VAULT_TRANSIT);
    expect(passwordCiphertext).toMatch(/^vault:v1:/);

    await expect(decryptCredentialValue(passwordCiphertext, scheme)).resolves.toBe('vault-pass');
    await expect(decryptCredentialValue(otpSecretCiphertext, scheme)).resolves.toBe('JBSWY3DPEHPK3PXP');

    const encryptUrl = String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[0]);
    expect(encryptUrl).toContain('/v1/transit/encrypt/alga-credentials-test');
  });

  it('throws when transit ciphertext rows exist but transit is not configured', async () => {
    delete process.env.ALGA_VAULT_ADDR;
    delete process.env.VAULT_ADDR;
    await expect(
      decryptCredentialValue('vault:v1:c2VjcmV0', CREDENTIAL_SCHEME_VAULT_TRANSIT)
    ).rejects.toThrow(/not configured/);
  });

  it('throws on a non-OK transit response', async () => {
    process.env.ALGA_VAULT_ADDR = 'https://vault.example.test';
    process.env.ALGA_VAULT_TOKEN = 'vault-token';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(
      encryptCredentialValues({ password: 'x', otpSecret: null })
    ).rejects.toThrow(/Vault Transit/);
  });
});

describe('credential encryption — unknown scheme is fail-closed', () => {
  it('throws on an unrecognized scheme tag', async () => {
    await expect(
      decryptCredentialValue('enc:whatever', 'base64' as never)
    ).rejects.toThrow(/Unknown credential encryption scheme/);
  });
});
