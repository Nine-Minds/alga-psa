import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

// --- Mocks -----------------------------------------------------------------
//
// getSecretProviderInstance is the source of all Sign in with Apple
// configuration. Every test in this file reconfigures it via
// `setMockedSecrets(...)`.

const mockedSecrets: Record<string, string | null> = {};

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_secretName: string, envVar: string, defaultValue: string = '') => {
    return mockedSecrets[envVar] ?? defaultValue;
  }),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async (key: string) => mockedSecrets[key] ?? null),
  })),
}));

function setMockedSecrets(values: Record<string, string | null>) {
  for (const k of Object.keys(mockedSecrets)) delete mockedSecrets[k];
  for (const [k, v] of Object.entries(values)) mockedSecrets[k] = v;
}

// Use a stable encryption key derived from a known secret so we can roundtrip.
process.env.NEXTAUTH_SECRET = 'test-nextauth-secret-please-do-not-use-in-prod';

// --- Helpers ---------------------------------------------------------------

const BUNDLE_ID = 'com.nineminds.algapsa';

type Keypair = {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  jwk: { kty: string; n: string; e: string; kid: string; alg: string; use: string };
  privatePem: string;
};

function makeRsaKeypair(kid: string): Keypair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwkRaw = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  return {
    privateKey,
    publicKey,
    jwk: { kty: 'RSA', n: jwkRaw.n, e: jwkRaw.e, kid, alg: 'RS256', use: 'sig' },
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function signAppleStyleToken(
  payload: Record<string, unknown>,
  keypair: Keypair,
  overrideKid?: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: 'https://appleid.apple.com', aud: BUNDLE_ID, iat: now, exp: now + 600, ...payload },
    keypair.privatePem,
    {
      algorithm: 'RS256',
      header: { alg: 'RS256', kid: overrideKid ?? keypair.jwk.kid },
    },
  );
}

function mockJwksFetch(keys: Array<Record<string, unknown>>) {
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ keys }),
    text: async () => JSON.stringify({ keys }),
  })) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

// --- Tests -----------------------------------------------------------------

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  setMockedSecrets({
    APPLE_SIGN_IN_BUNDLE_ID: BUNDLE_ID,
    APPLE_SIGN_IN_TEAM_ID: null,
    APPLE_SIGN_IN_KEY_ID: null,
    APPLE_SIGN_IN_PRIVATE_KEY: null,
  });
  const mod = await import('@/lib/mobileAuth/appleSignIn');
  mod.__resetAppleSignInConfigForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('appleSignIn — encrypt/decrypt refresh token', () => {
  it('roundtrips a refresh token through AES-256-GCM', async () => {
    const { encryptAppleRefreshToken, decryptAppleRefreshToken } = await import(
      '@/lib/mobileAuth/appleSignIn'
    );
    const plain = 'apple-refresh-token-' + crypto.randomBytes(8).toString('hex');

    const enc = await encryptAppleRefreshToken(plain);
    expect(enc.startsWith('enc:')).toBe(true);
    expect(enc).not.toContain(plain);

    const out = await decryptAppleRefreshToken(enc);
    expect(out).toBe(plain);
  });

  it('produces a different ciphertext on each encryption (random IV)', async () => {
    const { encryptAppleRefreshToken } = await import('@/lib/mobileAuth/appleSignIn');
    const a = await encryptAppleRefreshToken('same-plaintext');
    const b = await encryptAppleRefreshToken('same-plaintext');
    expect(a).not.toBe(b);
  });

  it('returns the value unchanged when it is not an enc: payload', async () => {
    const { decryptAppleRefreshToken } = await import('@/lib/mobileAuth/appleSignIn');
    const out = await decryptAppleRefreshToken('plain-value');
    expect(out).toBe('plain-value');
  });

  it('returns null when the enc: payload is too short to contain iv+tag', async () => {
    const { decryptAppleRefreshToken } = await import('@/lib/mobileAuth/appleSignIn');
    const out = await decryptAppleRefreshToken('enc:' + Buffer.from('short').toString('base64'));
    expect(out).toBeNull();
  });

  it('returns null when the auth tag is tampered with', async () => {
    const { encryptAppleRefreshToken, decryptAppleRefreshToken } = await import(
      '@/lib/mobileAuth/appleSignIn'
    );
    const enc = await encryptAppleRefreshToken('legitimate');
    const buf = Buffer.from(enc.slice(4), 'base64');
    // Flip a bit inside the GCM auth tag (bytes 12..28).
    buf[15] ^= 0x01;
    const tampered = 'enc:' + buf.toString('base64');
    const out = await decryptAppleRefreshToken(tampered);
    expect(out).toBeNull();
  });
});

describe('appleSignIn — verifyAppleIdentityToken', () => {
  it('verifies a well-formed token signed by an Apple JWKS key', async () => {
    const kp = makeRsaKeypair('apple-kid-1');
    mockJwksFetch([kp.jwk]);

    const token = signAppleStyleToken(
      { sub: '001234.apple.user', email: 'ada@example.com', email_verified: 'true' },
      kp,
    );

    const { verifyAppleIdentityToken } = await import('@/lib/mobileAuth/appleSignIn');
    const payload = await verifyAppleIdentityToken(token);

    expect(payload.iss).toBe('https://appleid.apple.com');
    expect(payload.aud).toBe(BUNDLE_ID);
    expect(payload.sub).toBe('001234.apple.user');
    expect(payload.email).toBe('ada@example.com');
  });

  it('rejects a token with the wrong audience', async () => {
    const kp = makeRsaKeypair('apple-kid-1');
    mockJwksFetch([kp.jwk]);

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { iss: 'https://appleid.apple.com', aud: 'com.someone.else', iat: now, exp: now + 600, sub: 'x' },
      kp.privatePem,
      { algorithm: 'RS256', header: { alg: 'RS256', kid: kp.jwk.kid } },
    );

    const { verifyAppleIdentityToken } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleIdentityToken(token)).rejects.toThrow();
  });

  it('rejects a token with the wrong issuer', async () => {
    const kp = makeRsaKeypair('apple-kid-1');
    mockJwksFetch([kp.jwk]);

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { iss: 'https://evil.example.com', aud: BUNDLE_ID, iat: now, exp: now + 600, sub: 'x' },
      kp.privatePem,
      { algorithm: 'RS256', header: { alg: 'RS256', kid: kp.jwk.kid } },
    );

    const { verifyAppleIdentityToken } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleIdentityToken(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const kp = makeRsaKeypair('apple-kid-1');
    mockJwksFetch([kp.jwk]);

    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = jwt.sign(
      { iss: 'https://appleid.apple.com', aud: BUNDLE_ID, iat: past - 100, exp: past, sub: 'x' },
      kp.privatePem,
      { algorithm: 'RS256', header: { alg: 'RS256', kid: kp.jwk.kid } },
    );

    const { verifyAppleIdentityToken } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleIdentityToken(token)).rejects.toThrow();
  });

  it('rejects when the kid is unknown even after a JWKS refresh', async () => {
    const kp = makeRsaKeypair('apple-kid-1');
    mockJwksFetch([kp.jwk]);

    const evilKp = makeRsaKeypair('attacker-kid');
    const token = signAppleStyleToken({ sub: 'attacker' }, evilKp);

    const { verifyAppleIdentityToken } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleIdentityToken(token)).rejects.toThrow(/Unknown Apple signing key/);
  });

  it('rejects a token whose signature does not validate against the published JWK', async () => {
    const real = makeRsaKeypair('apple-kid-1');
    const attacker = makeRsaKeypair('apple-kid-1');
    mockJwksFetch([real.jwk]); // server publishes the real key

    // Token signed with the attacker's private key but claiming the real kid.
    const token = signAppleStyleToken({ sub: 'attacker' }, attacker, real.jwk.kid);

    const { verifyAppleIdentityToken } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleIdentityToken(token)).rejects.toThrow();
  });

  it('rejects a malformed token (cannot be decoded)', async () => {
    mockJwksFetch([]);
    const { verifyAppleIdentityToken } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleIdentityToken('not-a-jwt')).rejects.toThrow(/Malformed Apple identity token/);
  });
});

describe('appleSignIn — code exchange / revocation guard', () => {
  it('exchangeAppleAuthorizationCode returns null when client-secret signing key is unconfigured', async () => {
    // Default mocks above leave team/key/private-key as null.
    const { exchangeAppleAuthorizationCode } = await import('@/lib/mobileAuth/appleSignIn');
    const result = await exchangeAppleAuthorizationCode('any-code');
    expect(result).toBeNull();
  });

  it('revokeAppleRefreshToken silently no-ops when client-secret signing key is unconfigured', async () => {
    const { revokeAppleRefreshToken } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(revokeAppleRefreshToken('any-token')).resolves.toBeUndefined();
  });
});

describe('appleSignIn — config loading', () => {
  it('throws when bundle id is unset', async () => {
    setMockedSecrets({
      APPLE_SIGN_IN_BUNDLE_ID: null,
      APPLE_SIGN_IN_TEAM_ID: null,
      APPLE_SIGN_IN_KEY_ID: null,
      APPLE_SIGN_IN_PRIVATE_KEY: null,
    });
    const { getAppleSignInConfig, __resetAppleSignInConfigForTests } = await import(
      '@/lib/mobileAuth/appleSignIn'
    );
    __resetAppleSignInConfigForTests();
    await expect(getAppleSignInConfig()).rejects.toThrow(/APPLE_SIGN_IN_BUNDLE_ID/);
  });
});

describe('appleSignIn — verifyAppleServerNotification', () => {
  it('verifies a signed JWS and parses the inner events JSON string', async () => {
    const kp = makeRsaKeypair('s2s-key-1');
    mockJwksFetch([kp.jwk]);

    const eventTime = Math.floor(Date.now() / 1000);
    const token = signAppleStyleToken(
      {
        jti: 'notif-1',
        events: JSON.stringify({
          type: 'consent-revoked',
          sub: '001234.user',
          email: 'ada@privaterelay.appleid.com',
          is_private_email: 'true',
          event_time: eventTime,
        }),
      },
      kp,
    );

    const { verifyAppleServerNotification } = await import('@/lib/mobileAuth/appleSignIn');
    const out = await verifyAppleServerNotification(token);

    expect(out.iss).toBe('https://appleid.apple.com');
    expect(out.aud).toBe(BUNDLE_ID);
    expect(out.jti).toBe('notif-1');
    expect(out.events.type).toBe('consent-revoked');
    expect(out.events.sub).toBe('001234.user');
    expect(out.events.email).toBe('ada@privaterelay.appleid.com');
    expect(out.events.is_private_email).toBe('true');
    expect(out.events.event_time).toBe(eventTime);
  });

  it('rejects when the audience is wrong (a different bundle)', async () => {
    const kp = makeRsaKeypair('s2s-key-2');
    mockJwksFetch([kp.jwk]);
    const token = jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: 'com.some.other.app',
        iat: Math.floor(Date.now() / 1000),
        jti: 'x',
        events: JSON.stringify({ type: 'consent-revoked', sub: 'x', event_time: 0 }),
      },
      kp.privatePem,
      { algorithm: 'RS256', header: { alg: 'RS256', kid: kp.jwk.kid } },
    );

    const { verifyAppleServerNotification } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleServerNotification(token)).rejects.toThrow();
  });

  it('rejects a signature that does not match any published Apple key', async () => {
    const goodKp = makeRsaKeypair('good-key');
    const wrongKp = makeRsaKeypair('good-key'); // same kid, different key material
    mockJwksFetch([goodKp.jwk]);

    const token = signAppleStyleToken(
      { jti: 'n', events: JSON.stringify({ type: 'consent-revoked', sub: 'x', event_time: 0 }) },
      wrongKp,
    );

    const { verifyAppleServerNotification } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleServerNotification(token)).rejects.toThrow();
  });

  it('rejects when the inner events claim is missing', async () => {
    const kp = makeRsaKeypair('s2s-key-3');
    mockJwksFetch([kp.jwk]);
    const token = signAppleStyleToken({ jti: 'n' }, kp);

    const { verifyAppleServerNotification } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleServerNotification(token)).rejects.toThrow(/events/i);
  });

  it('rejects when the events claim is not valid JSON', async () => {
    const kp = makeRsaKeypair('s2s-key-4');
    mockJwksFetch([kp.jwk]);
    const token = signAppleStyleToken({ jti: 'n', events: 'not-json{{' }, kp);

    const { verifyAppleServerNotification } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleServerNotification(token)).rejects.toThrow();
  });

  it('rejects when the events payload has no type or sub', async () => {
    const kp = makeRsaKeypair('s2s-key-5');
    mockJwksFetch([kp.jwk]);
    const token = signAppleStyleToken(
      { jti: 'n', events: JSON.stringify({ foo: 'bar' }) },
      kp,
    );

    const { verifyAppleServerNotification } = await import('@/lib/mobileAuth/appleSignIn');
    await expect(verifyAppleServerNotification(token)).rejects.toThrow();
  });
});
