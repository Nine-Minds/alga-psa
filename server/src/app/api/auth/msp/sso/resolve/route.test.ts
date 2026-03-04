import { beforeEach, describe, expect, it, vi } from 'vitest';

const setCookieMock = vi.fn();
const consumeLimiterMock = vi.fn(async () => ({ remainingPoints: 7 }));
const resolveSourceMock = vi.fn();
const getSigningSecretMock = vi.fn(async () => 'unit-test-signing-secret');
const parseDiscoveryCookieMock = vi.fn();
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
  MSP_SSO_DISCOVERY_COOKIE: 'msp_sso_discovery',
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
  parseAndVerifyMspSsoDiscoveryCookie: (...args: unknown[]) => parseDiscoveryCookieMock(...args),
  parseResolverProvider: (value: unknown) =>
    value === 'google' || value === 'azure-ad' ? value : null,
  resolveMspSsoCredentialSource: (...args: unknown[]) => resolveSourceMock(...args),
}));

const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

const { POST } = await import('./route');

type RequestOptions = {
  headers?: Record<string, string>;
  discoveryCookie?: string;
};

function buildRequest(body: Record<string, unknown>, options?: RequestOptions) {
  const request = new Request('https://example.com/api/auth/msp/sso/resolve', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
      ...(options?.headers || {}),
    },
    body: JSON.stringify(body),
  }) as Request & { cookies: { get: (name: string) => { value: string } | undefined } };

  request.cookies = {
    get: (name: string) => {
      if (name === 'msp_sso_discovery' && options?.discoveryCookie) {
        return { value: options.discoveryCookie };
      }
      return undefined;
    },
  };

  return request;
}

describe('POST /api/auth/msp/sso/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveSourceMock.mockResolvedValue({ resolved: true, source: 'app' });
    getSigningSecretMock.mockResolvedValue('unit-test-signing-secret');
    parseDiscoveryCookieMock.mockReturnValue(null);
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

  it('T039: consumes discovery context when cookie is valid and resolves provider source', async () => {
    parseDiscoveryCookieMock.mockReturnValueOnce({
      source: 'tenant',
      tenantId: 'tenant-1',
      domain: 'acme.com',
      providers: ['azure-ad'],
      issuedAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
      nonce: 'nonce-1',
    });
    resolveSourceMock.mockResolvedValueOnce({ resolved: true, source: 'tenant', tenantId: 'tenant-1' });

    const response = await POST(
      buildRequest(
        { provider: 'azure-ad', email: 'user@example.com', callbackUrl: '/msp' },
        { discoveryCookie: 'signed-discovery-cookie' }
      ) as any
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    expect(parseDiscoveryCookieMock).toHaveBeenCalledWith({
      value: 'signed-discovery-cookie',
      secret: 'unit-test-signing-secret',
    });
    expect(resolveSourceMock).toHaveBeenCalledWith({
      provider: 'azure-ad',
      email: 'user@example.com',
      discovery: expect.objectContaining({ source: 'tenant', tenantId: 'tenant-1' }),
    });
    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_sso_resolution',
        value: 'signed-cookie-value',
        maxAge: 300,
        httpOnly: true,
        sameSite: 'lax',
      })
    );
  });

  it('T040: requested provider not in discovered allow-list returns generic failure', async () => {
    parseDiscoveryCookieMock.mockReturnValueOnce({
      source: 'tenant',
      tenantId: 'tenant-1',
      domain: 'acme.com',
      providers: ['azure-ad'],
      issuedAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
      nonce: 'nonce-2',
    });
    resolveSourceMock.mockResolvedValueOnce({ resolved: false });

    const response = await POST(
      buildRequest(
        { provider: 'google', email: 'user@example.com', callbackUrl: '/msp' },
        { discoveryCookie: 'signed-discovery-cookie' }
      ) as any
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "We couldn't start SSO sign-in. Please verify provider setup and try again.",
    });
  });

  it('T041: missing or invalid discovery context falls back to app-level resolver path', async () => {
    parseDiscoveryCookieMock.mockReturnValueOnce(null);
    resolveSourceMock.mockResolvedValueOnce({ resolved: true, source: 'app' });

    const response = await POST(
      buildRequest({ provider: 'google', email: 'user@example.com', callbackUrl: '/msp' }) as any
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(resolveSourceMock).toHaveBeenCalledWith({
      provider: 'google',
      email: 'user@example.com',
      discovery: null,
    });
  });

  it('T042: unknown-user and known-user resolver misses are externally indistinguishable', async () => {
    resolveSourceMock.mockResolvedValue({ resolved: false });

    const unknownLikeResponse = await POST(
      buildRequest({ provider: 'google', email: 'ghost@example.com', callbackUrl: '/msp' }) as any
    );
    const knownLikeResponse = await POST(
      buildRequest({ provider: 'google', email: 'known@example.com', callbackUrl: '/msp' }) as any
    );

    const expected = {
      ok: false,
      message: "We couldn't start SSO sign-in. Please verify provider setup and try again.",
    };

    await expect(unknownLikeResponse.json()).resolves.toEqual(expected);
    await expect(knownLikeResponse.json()).resolves.toEqual(expected);
  });

  it('T043: resolver rate-limit failures preserve the generic response shape', async () => {
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

  it('T044: resolver logs exclude raw email and sensitive fields', async () => {
    resolveSourceMock.mockResolvedValueOnce({ resolved: true, source: 'tenant', tenantId: 'tenant-1' });

    await POST(buildRequest({ provider: 'google', email: 'person@example.com', callbackUrl: '/msp' }) as any);

    expect(infoSpy).toHaveBeenCalledWith('[msp-sso-resolve] credential source selected', {
      provider: 'google',
      source: 'tenant',
    });

    const logBlob = JSON.stringify(infoSpy.mock.calls);
    expect(logBlob).not.toContain('person@example.com');
    expect(logBlob).not.toContain('client_secret');
  });

  it('returns generic failure when signing secret is missing', async () => {
    getSigningSecretMock.mockResolvedValueOnce(null);

    const response = await POST(
      buildRequest({ provider: 'google', email: 'user@example.com', callbackUrl: '/msp' }) as any
    );

    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "We couldn't start SSO sign-in. Please verify provider setup and try again.",
    });
    expect(warnSpy).toHaveBeenCalled();
  });
});
