import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveTeamsTabAuthStateMock = vi.fn();

class MockNextResponse {
  status: number;
  headers: Headers;
  private body: string;

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this.status = init?.status ?? 200;
    this.headers = new Headers(init?.headers);
    this.body = typeof body === 'string' ? body : '';
  }

  static redirect(url: string | URL, init?: ResponseInit) {
    return new MockNextResponse('', {
      status: init?.status ?? 307,
      headers: {
        location: typeof url === 'string' ? url : url.toString(),
      },
    });
  }

  async text() {
    return this.body;
  }
}

vi.mock('next/server', () => ({
  NextRequest: Request,
  NextResponse: MockNextResponse,
}));

vi.mock('server/src/lib/teams/resolveTeamsTabAuthState', () => ({
  resolveTeamsTabAuthState: (...args: unknown[]) => resolveTeamsTabAuthStateMock(...args),
}));

const { GET } = await import('./route');

describe('GET /api/teams/auth/callback/bot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTeamsTabAuthStateMock.mockReset();
  });

  it('T153: returns a Teams bot auth callback payload with resolved tenant and MSP user context', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue({
      status: 'ready',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userName: 'Taylor Tech',
      userEmail: 'taylor@example.com',
      profileId: 'profile-1',
      microsoftTenantId: 'entra-tenant-1',
    });

    const response = await GET(
      new Request('https://example.com/api/teams/auth/callback/bot?tenantId=tenant-1') as any
    );

    expect(resolveTeamsTabAuthStateMock).toHaveBeenCalledWith({ expectedTenantId: 'tenant-1' });
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"surface":"bot"');
    await expect(response.text()).resolves.toContain('"status":"ready"');
    await expect(response.text()).resolves.toContain('"tenantId":"tenant-1"');
    await expect(response.text()).resolves.toContain('"userId":"user-1"');
  });

  it('T154: redirects unauthenticated bot auth requests and returns Teams-safe failure payloads for rejected access', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValueOnce({
      status: 'unauthenticated',
      message: 'Sign in with your MSP account to open Alga PSA in Teams.',
    });

    const redirectResponse = await GET(
      new Request('https://example.com/api/teams/auth/callback/bot?tenantId=tenant-1') as any
    );

    expect(redirectResponse.status).toBe(307);
    expect(redirectResponse.headers.get('location')).toBe(
      'https://example.com/auth/msp/signin?callbackUrl=%2Fapi%2Fteams%2Fauth%2Fcallback%2Fbot%3FtenantId%3Dtenant-1'
    );

    resolveTeamsTabAuthStateMock.mockResolvedValueOnce({
      status: 'forbidden',
      reason: 'client_user',
      tenantId: 'tenant-1',
      message: 'Microsoft Teams access is available only to MSP users in v1.',
    });

    const forbiddenResponse = await GET(
      new Request('https://example.com/api/teams/auth/callback/bot?tenantId=tenant-1') as any
    );

    expect(forbiddenResponse.status).toBe(200);
    await expect(forbiddenResponse.text()).resolves.toContain('"surface":"bot"');
    await expect(forbiddenResponse.text()).resolves.toContain('"status":"forbidden"');
    await expect(forbiddenResponse.text()).resolves.toContain('Microsoft Teams access is available only to MSP users in v1.');
  });
});
