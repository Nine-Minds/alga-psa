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

const { GET } = await import('../../../../../../../../ee/server/src/app/api/teams/auth/callback/message-extension/route');

describe('GET /api/teams/auth/callback/message-extension', () => {
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

  it('T155: returns a Teams message-extension auth callback payload with resolved tenant and MSP user context', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValue({
      status: 'ready',
      tenantId: 'tenant-1',
      userId: 'user-2',
      userName: 'Morgan Message',
      userEmail: 'morgan@example.com',
      profileId: 'profile-1',
      microsoftTenantId: 'entra-tenant-1',
    });

    const response = await GET(
      new Request(
        'https://example.com/api/teams/auth/callback/message-extension?tenantId=tenant-1&tid=entra-tenant-1'
      ) as any
    );

    expect(resolveTeamsTabAuthStateMock).toHaveBeenCalledWith({
      expectedTenantId: 'tenant-1',
      expectedMicrosoftTenantId: 'entra-tenant-1',
    });
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"surface":"message_extension"');
    await expect(response.text()).resolves.toContain('"status":"ready"');
    await expect(response.text()).resolves.toContain('"tenantId":"tenant-1"');
    await expect(response.text()).resolves.toContain('"userId":"user-2"');
  });

  it('T156: redirects unauthenticated message-extension auth requests and returns Teams-safe failure payloads for rejected access', async () => {
    resolveTeamsTabAuthStateMock.mockResolvedValueOnce({
      status: 'unauthenticated',
      message: 'Sign in with your MSP account to open Alga PSA in Teams.',
    });

    const redirectResponse = await GET(
      new Request('https://example.com/api/teams/auth/callback/message-extension?tenantId=tenant-1') as any
    );

    expect(redirectResponse.status).toBe(307);
    expect(redirectResponse.headers.get('location')).toBe(
      'https://example.com/auth/msp/signin?callbackUrl=%2Fapi%2Fteams%2Fauth%2Fcallback%2Fmessage-extension%3FtenantId%3Dtenant-1&teamsReauth=1'
    );

    resolveTeamsTabAuthStateMock.mockResolvedValueOnce({
      status: 'forbidden',
      reason: 'wrong_tenant',
      tenantId: 'tenant-1',
      message: 'This Teams tab request does not match your PSA tenant.',
    });

    const forbiddenResponse = await GET(
      new Request('https://example.com/api/teams/auth/callback/message-extension?tenantId=tenant-2') as any
    );

    expect(forbiddenResponse.status).toBe(200);
    await expect(forbiddenResponse.text()).resolves.toContain('"surface":"message_extension"');
    await expect(forbiddenResponse.text()).resolves.toContain('"status":"forbidden"');
    await expect(forbiddenResponse.text()).resolves.toContain('This Teams tab request does not match your PSA tenant.');
  });

  it('T133: returns a disabled payload when the tenant flag is off before resolving Teams auth state', async () => {
    getTeamsAvailabilityMock.mockResolvedValue({
      enabled: false,
      reason: 'flag_disabled',
      flagKey: 'teams-integration-ui',
      message: 'Microsoft Teams integration is disabled for this tenant.',
    });

    const response = await GET(
      new Request('https://example.com/api/teams/auth/callback/message-extension?tenantId=tenant-1') as any
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('"status":"disabled"');
    await expect(response.text()).resolves.toContain('Microsoft Teams integration is disabled for this tenant.');
    expect(resolveTeamsTabAuthStateMock).not.toHaveBeenCalled();
  });
});
