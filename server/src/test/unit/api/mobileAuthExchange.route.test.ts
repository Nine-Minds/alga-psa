import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ForbiddenError } from '@/lib/api/middleware/apiMiddleware';

const exchangeOttForSessionMock = vi.hoisted(() => vi.fn());
const enforceMobileOttExchangeLimitMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/mobileAuth/mobileAuthService', () => ({
  exchangeOttForSession: exchangeOttForSessionMock,
  exchangeOttSchema: {
    parse: (value: unknown) => value,
  },
}));

vi.mock('@/lib/security/mobileAuthRateLimiting', () => ({
  enforceMobileOttExchangeLimit: enforceMobileOttExchangeLimitMock,
}));

describe('POST /api/v1/mobile/auth/exchange', () => {
  beforeEach(() => {
    exchangeOttForSessionMock.mockReset();
    enforceMobileOttExchangeLimitMock.mockReset();
    enforceMobileOttExchangeLimitMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a 403 upgrade message when mobile access is tier-gated', async () => {
    exchangeOttForSessionMock.mockRejectedValue(new ForbiddenError('Mobile app access requires Pro or higher'));

    vi.resetModules();
    const { POST } = await import('@/app/api/v1/mobile/auth/exchange/route');

    const request = new NextRequest(
      new Request('http://example.com/api/v1/mobile/auth/exchange', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.25',
        },
        body: JSON.stringify({
          ott: 'ott-123',
          state: 'state-123',
          device: { deviceId: 'device-1' },
        }),
      }),
    );

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Mobile app access requires Pro or higher',
        details: undefined,
      },
    });
    expect(enforceMobileOttExchangeLimitMock).toHaveBeenCalledWith('203.0.113.25');
  });
});
