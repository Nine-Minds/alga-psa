import { beforeEach, describe, expect, it, vi } from 'vitest';

const setCookieMock = vi.fn();
const getSessionMock = vi.fn();

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

vi.mock('@alga-psa/auth', () => ({
  getSession: () => getSessionMock(),
}));

const { POST } = await import('./route');

function buildRequest(body: Record<string, unknown>) {
  return new Request('https://example.com/api/auth/msp/remember-email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/msp/remember-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: {
        id: 'user-1',
        user_type: 'internal',
        tenant: 'tenant-1',
      },
    });
  });

  it('T006: stores the normalized lowercase email when public-workstation is false', async () => {
    const response = await POST(
      buildRequest({ email: 'User@Example.COM', publicWorkstation: false }) as any
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_remembered_email',
        value: 'user@example.com',
      })
    );
  });

  it('T007: clears the durable cookie when public-workstation is true', async () => {
    const response = await POST(
      buildRequest({ email: 'user@example.com', publicWorkstation: true }) as any
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_remembered_email',
        value: '',
        maxAge: 0,
        httpOnly: true,
      })
    );
  });

  it('T009: trims whitespace and lowercases mixed-case email values before persistence', async () => {
    await POST(buildRequest({ email: '  MixedCase@Example.COM  ' }) as any);

    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 'mixedcase@example.com',
      })
    );
  });

  it('T010: writes the durable remembered-email cookie with a 180-day max age', async () => {
    await POST(buildRequest({ email: 'user@example.com' }) as any);

    expect(setCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAge: 180 * 24 * 60 * 60,
        httpOnly: true,
        sameSite: 'lax',
      })
    );
  });

  it('T022: a later successful remember-email write replaces the previously remembered email', async () => {
    await POST(buildRequest({ email: 'first@example.com' }) as any);
    await POST(buildRequest({ email: 'second@example.com' }) as any);

    expect(setCookieMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'msp_remembered_email',
        value: 'second@example.com',
      })
    );
  });
});
