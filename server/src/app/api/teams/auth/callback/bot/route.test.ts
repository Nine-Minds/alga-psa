import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveTeamsTabAuthStateMock = vi.fn();
const getTeamsAvailabilityMock = vi.fn();

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

vi.mock('../../../../../../../../ee/server/src/lib/teams/resolveTeamsTabAuthState', () => ({
  resolveTeamsTabAuthState: (...args: unknown[]) => resolveTeamsTabAuthStateMock(...args),
}));

vi.mock('@alga-psa/integrations/lib/teamsAvailability', () => ({
  getTeamsAvailability: (...args: unknown[]) => getTeamsAvailabilityMock(...args),
}));

const { GET } = await import('../../../../../../../../ee/server/src/app/api/teams/auth/callback/bot/route');

describe('GET /api/teams/auth/callback/bot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTeamsTabAuthStateMock.mockReset();
    getTeamsAvailabilityMock.mockReset();
    getTeamsAvailabilityMock.mockResolvedValue({
      enabled: true,
      reason: 'enabled',
      flagKey: 'teams-integration-ui',
    });
  });

  it('T153/T173: returns a Teams bot auth callback payload with resolved tenant and MSP user context for slug-based or vanity-host entry points', async () => {
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
      new Request(
        'https://desk.example.com/api/teams/auth/callback/bot?tenant=acme-helpdesk&tid=entra-tenant-1'
      ) as any
    );

    expect(resolveTeamsTabAuthStateMock).toHaveBeenCalledWith({
      expectedTenantId: 'acme-helpdesk',
      expectedMicrosoftTenantId: 'entra-tenant-1',
    });
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"surface":"bot"');
    await expect(response.text()).resolves.toContain('"status":"ready"');
    await expect(response.text()).resolves.toContain('"tenantId":"tenant-1"');
    await expect(response.text()).resolves.toContain('"userId":"user-1"');
  });

  it('T154/T172: redirects unauthenticated bot auth requests into the Teams-safe reauthentication path and returns safe failure payloads for rejected access', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValueOnce({
      status: 'unauthenticated',
      message: 'Sign in with your MSP account to open Alga PSA in Teams.',
    });

    const redirectResponse = await GET(
      new Request('https://example.com/api/teams/auth/callback/bot?tenantId=tenant-1') as any
    );

    expect(redirectResponse.status).toBe(307);
    expect(redirectResponse.headers.get('location')).toBe(
      'https://example.com/auth/msp/signin?callbackUrl=%2Fapi%2Fteams%2Fauth%2Fcallback%2Fbot%3FtenantId%3Dtenant-1&teamsReauth=1'
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

  it('T182: keeps not-configured bot auth responses distinct from unauthenticated redirects and forbidden access payloads', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue({
      status: 'not_configured',
      tenantId: 'tenant-1',
      message: 'Teams is not configured for this tenant',
    });

    const response = await GET(
      new Request('https://example.com/api/teams/auth/callback/bot?tenantId=tenant-1') as any
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"surface":"bot"');
    await expect(response.text()).resolves.toContain('"status":"not_configured"');
    await expect(response.text()).resolves.toContain('Teams is not configured for this tenant');
  });
});
