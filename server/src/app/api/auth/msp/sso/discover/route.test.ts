import { beforeEach, describe, expect, it, vi } from 'vitest';

const setCookieMock = vi.fn();
const consumeLimiterMock = vi.fn(async () => ({ remainingPoints: 11 }));
const discoverMock = vi.fn();
const getSigningSecretMock = vi.fn(async () => 'unit-test-signing-secret');
const createCookieMock = vi.fn(() => ({
  value: 'signed-discovery-cookie-value',
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
  MSP_SSO_DISCOVERY_TTL_SECONDS: 300,
  createSignedMspSsoDiscoveryCookie: (...args: unknown[]) => createCookieMock(...args),
  discoverMspSsoProviderOptions: (...args: unknown[]) => discoverMock(...args),
  extractDomainFromEmail: (value: string) => {
    const normalized = value.trim().toLowerCase();
    const idx = normalized.lastIndexOf('@');
    return idx > 0 ? normalized.slice(idx + 1) : null;
  },
  getMspSsoSigningSecret: () => getSigningSecretMock(),
  normalizeResolverEmail: (value: string) => value.trim().toLowerCase(),
}));

const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

const { POST } = await import('./route');

function buildRequest(body: Record<string, unknown>, extraHeaders?: Record<string, string>) {
  return new Request('https://example.com/api/auth/msp/sso/discover', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/msp/sso/discover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discoverMock.mockResolvedValue({
      source: 'app',
      providers: ['google'],
      domain: 'example.com',
      ambiguous: false,
    });
    getSigningSecretMock.mockResolvedValue('unit-test-signing-secret');
    createCookieMock.mockReturnValue({ value: 'signed-discovery-cookie-value' });
    consumeLimiterMock.mockResolvedValue({ remainingPoints: 11 });
  });

  it('T017: invalid email returns invariant neutral response and clears stale cookie', async () => {
    const response = await POST(buildRequest({ email: 'not-an-email' }) as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providers: [],
    });

    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_sso_discovery',
        value: '',
        maxAge: 0,
      })
    );
  });

  it('T018: normalizes mixed-case email before discovery and returns providers', async () => {
    const response = await POST(buildRequest({ email: '  User@Example.COM  ' }) as any);

    await expect(response.json()).resolves.toEqual({
      ok: true,
      providers: ['google'],
    });
    expect(discoverMock).toHaveBeenCalledWith('user@example.com');
  });

  it('T019: rate-limited requests return the same neutral response schema', async () => {
    consumeLimiterMock.mockRejectedValueOnce(new Error('rate limited'));

    const response = await POST(buildRequest({ email: 'user@example.com' }) as any);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providers: [],
    });
  });

  it('T027/T030: sets signed discovery cookie on valid requests and logs safe metadata', async () => {
    discoverMock.mockResolvedValueOnce({
      source: 'tenant',
      tenantId: 'tenant-1',
      providers: ['azure-ad'],
      domain: 'acme.com',
      ambiguous: false,
    });

    const response = await POST(buildRequest({ email: 'person@acme.com' }) as any);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providers: ['azure-ad'],
    });

    expect(createCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'tenant',
        tenantId: 'tenant-1',
        domain: 'acme.com',
        providers: ['azure-ad'],
      })
    );
    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_sso_discovery',
        value: 'signed-discovery-cookie-value',
        maxAge: 300,
        httpOnly: true,
        sameSite: 'lax',
      })
    );

    expect(infoSpy).toHaveBeenCalledWith('[msp-sso-discover] provider options resolved', {
      source: 'tenant',
      providerCount: 1,
      domain: 'acme.com',
      ambiguous: false,
    });
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('person@acme.com');
  });

  it('returns neutral response when signing secret is missing', async () => {
    getSigningSecretMock.mockResolvedValueOnce(null);

    const response = await POST(buildRequest({ email: 'user@example.com' }) as any);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providers: [],
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('T030: rotates cookie value across successful discovery requests', async () => {
    createCookieMock
      .mockReturnValueOnce({ value: 'signed-discovery-cookie-one' })
      .mockReturnValueOnce({ value: 'signed-discovery-cookie-two' });

    await POST(buildRequest({ email: 'user@example.com' }) as any);
    await POST(buildRequest({ email: 'user@example.com' }) as any);

    const cookieValues = setCookieMock.mock.calls
      .map((call) => call[0])
      .filter((cookie) => cookie?.name === 'msp_sso_discovery' && cookie.value)
      .map((cookie) => cookie.value);

    expect(cookieValues[cookieValues.length - 2]).toBe('signed-discovery-cookie-one');
    expect(cookieValues[cookieValues.length - 1]).toBe('signed-discovery-cookie-two');
  });
});
