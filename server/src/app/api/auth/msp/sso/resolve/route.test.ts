import { beforeEach, describe, expect, it, vi } from 'vitest';

const setCookieMock = vi.fn();
const consumeLimiterMock = vi.fn(async () => ({ remainingPoints: 7 }));

const resolveSourceMock = vi.fn();
const getSigningSecretMock = vi.fn(async () => 'unit-test-signing-secret');
const createCookieMock = vi.fn(() => ({
  value: 'signed-cookie-value',
  payload: {
    provider: 'google',
    source: 'app',
    issuedAt: 1,
    expiresAt: 2,
    nonce: 'nonce',
  },
}));

vi.mock('rate-limiter-flexible', () => ({
  RateLimiterMemory: class {
    consume(key: string) {
      return consumeLimiterMock(key);
    }
  },
}));

vi.mock('next/server', () => ({
  NextRequest: Request,
  NextResponse: {
    json: vi.fn((data, init) => ({
      status: init?.status ?? 200,
      json: async () => data,
      cookies: {
        set: setCookieMock,
      },
    })),
  },
}));

vi.mock('@alga-psa/auth/lib/sso/mspSsoResolution', () => ({
  MSP_SSO_GENERIC_FAILURE_MESSAGE:
    "We couldn't start SSO sign-in. Please verify provider setup and try again.",
  MSP_SSO_RESOLUTION_COOKIE: 'msp_sso_resolution',
  MSP_SSO_RESOLUTION_TTL_SECONDS: 300,
  createSignedMspSsoResolutionCookie: (...args: unknown[]) => createCookieMock(...args),
  getMspSsoSigningSecret: () => getSigningSecretMock(),
  isValidResolverCallbackUrl: (value: string | undefined) => {
    if (!value || !value.trim()) return true;
    return value.startsWith('/') || value.startsWith('http://') || value.startsWith('https://');
  },
  normalizeResolverEmail: (value: string) => value.trim().toLowerCase(),
  parseResolverProvider: (value: unknown) =>
    value === 'google' || value === 'azure-ad' ? value : null,
  resolveMspSsoCredentialSource: (...args: unknown[]) => resolveSourceMock(...args),
}));

const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

const { POST } = await import('./route');

function buildRequest(body: Record<string, unknown>, extraHeaders?: Record<string, string>) {
  return new Request('https://example.com/api/auth/msp/sso/resolve', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/msp/sso/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveSourceMock.mockResolvedValue({ resolved: true, source: 'app', userFound: false });
    getSigningSecretMock.mockResolvedValue('unit-test-signing-secret');
    createCookieMock.mockReturnValue({
      value: 'signed-cookie-value',
      payload: {
        provider: 'google',
        source: 'app',
        issuedAt: 1,
        expiresAt: 2,
        nonce: 'nonce',
      },
    });
    consumeLimiterMock.mockResolvedValue({ remainingPoints: 7 });
  });

  it('T030: accepts valid payload, returns { ok: true }, and sets signed context cookie', async () => {
    const response = await POST(
      buildRequest({ provider: 'google', email: 'user@example.com', callbackUrl: '/msp' }) as any
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_sso_resolution',
        value: 'signed-cookie-value',
        httpOnly: true,
        sameSite: 'lax',
      })
    );
  });

  it('T031: invalid provider returns generic failure schema', async () => {
    const response = await POST(
      buildRequest({ provider: 'invalid', email: 'user@example.com', callbackUrl: '/msp' }) as any
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "We couldn't start SSO sign-in. Please verify provider setup and try again.",
    });
  });

  it('T037: unknown-user and known-user-missing-provider app-fallback paths return same success schema', async () => {
    resolveSourceMock
      .mockResolvedValueOnce({ resolved: true, source: 'app', userFound: false })
      .mockResolvedValueOnce({ resolved: true, source: 'app', userFound: true });

    const unknownUserResponse = await POST(
      buildRequest({ provider: 'google', email: 'ghost@example.com', callbackUrl: '/msp' }) as any
    );
    const knownUserMissingTenantSourceResponse = await POST(
      buildRequest({ provider: 'google', email: 'known@example.com', callbackUrl: '/msp' }) as any
    );

    await expect(unknownUserResponse.json()).resolves.toEqual({ ok: true });
    await expect(knownUserMissingTenantSourceResponse.json()).resolves.toEqual({ ok: true });
  });

  it('T038/T064: unknown-user no-source path matches known-user no-source generic failure shape', async () => {
    resolveSourceMock
      .mockResolvedValueOnce({ resolved: false, userFound: false })
      .mockResolvedValueOnce({ resolved: false, userFound: true });

    const unknownUserResponse = await POST(
      buildRequest({ provider: 'azure-ad', email: 'ghost@example.com', callbackUrl: '/msp' }) as any
    );
    const knownNoSourceResponse = await POST(
      buildRequest({ provider: 'azure-ad', email: 'known@example.com', callbackUrl: '/msp' }) as any
    );

    const expected = {
      ok: false,
      message: "We couldn't start SSO sign-in. Please verify provider setup and try again.",
    };

    await expect(unknownUserResponse.json()).resolves.toEqual(expected);
    await expect(knownNoSourceResponse.json()).resolves.toEqual(expected);
  });

  it('T044: rate limiting abusive requests returns generic failure response', async () => {
    consumeLimiterMock.mockRejectedValueOnce(new Error('rate limited'));

    const response = await POST(
      buildRequest({ provider: 'google', email: 'user@example.com', callbackUrl: '/msp' }) as any
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "We couldn't start SSO sign-in. Please verify provider setup and try again.",
    });
  });

  it('T045: structured resolver logs include provider/source without raw email or secrets', async () => {
    resolveSourceMock.mockResolvedValue({ resolved: true, source: 'tenant', userFound: true, tenantId: 't-1' });

    await POST(buildRequest({ provider: 'google', email: 'person@example.com', callbackUrl: '/msp' }) as any);

    expect(infoSpy).toHaveBeenCalledWith('[msp-sso-resolve] credential source selected', {
      provider: 'google',
      source: 'tenant',
    });

    const logBlob = JSON.stringify(infoSpy.mock.calls);
    expect(logBlob).not.toContain('person@example.com');
    expect(logBlob).not.toContain('client_secret');
    expect(logBlob).not.toContain('userFound');
  });

  it('T052: each successful start attempt overwrites resolver cookie value', async () => {
    createCookieMock
      .mockReturnValueOnce({ value: 'signed-cookie-one', payload: {} as any })
      .mockReturnValueOnce({ value: 'signed-cookie-two', payload: {} as any });

    await POST(buildRequest({ provider: 'google', email: 'a@example.com', callbackUrl: '/msp' }) as any);
    await POST(buildRequest({ provider: 'google', email: 'a@example.com', callbackUrl: '/msp' }) as any);

    const cookieValues = setCookieMock.mock.calls
      .map((call) => call[0])
      .filter((cookie) => cookie?.name === 'msp_sso_resolution' && cookie.value)
      .map((cookie) => cookie.value);

    expect(cookieValues[cookieValues.length - 2]).toBe('signed-cookie-one');
    expect(cookieValues[cookieValues.length - 1]).toBe('signed-cookie-two');
  });
});
