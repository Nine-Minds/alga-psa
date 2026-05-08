import { describe, expect, it } from 'vitest';

import {
  TooManyRequestsError,
  createPaginatedResponse,
  createSuccessResponse,
  handleApiError,
} from '@/lib/api/middleware/apiMiddleware';

describe('apiMiddleware response headers', () => {
  it('merges ApiError.headers into error responses', async () => {
    const error = new TooManyRequestsError('Slow down', { remaining: 0 });
    error.headers = {
      'Retry-After': '60',
      'X-RateLimit-Remaining': '0',
    };

    const response = handleApiError(error);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('adds extra headers to success responses', () => {
    const response = createSuccessResponse(
      { ok: true },
      200,
      undefined,
      undefined,
      { 'X-RateLimit-Limit': '120' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120');
  });

  it('derives success headers from request.context.rateLimit when a request is provided', () => {
    const response = createSuccessResponse(
      { ok: true },
      200,
      undefined,
      {
        context: {
          tenant: 'tenant-1',
          userId: 'user-1',
          rateLimit: {
            limit: 120,
            remaining: 119,
            resetAt: '2026-05-05T00:00:00.000Z',
          },
        },
      } as any,
    );

    expect(response.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119');
  });

  it('adds extra headers to paginated responses', () => {
    const response = createPaginatedResponse(
      [{ id: 1 }],
      1,
      1,
      25,
      undefined,
      undefined,
      { 'X-RateLimit-Remaining': '119' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119');
  });
});
