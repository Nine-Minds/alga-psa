import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server/src/app/api/auth/[...nextauth]/edge-auth', () => ({
  auth: (handler: any) => handler,
}));

vi.mock('server/src/middleware/i18n', () => ({
  shouldSkipI18n: () => true,
  i18nMiddleware: () => undefined,
}));

let middleware: (request: NextRequest) => Promise<Response> | Response;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;

describe('middleware', () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.NEXTAUTH_URL = 'https://auth.example.com';

    ({ default: middleware } = await import('server/src/middleware'));
  });

  afterEach(() => {
    if (typeof originalNextAuthUrl === 'undefined') {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    }
  });

  it('redirects internal users hitting client portal dashboard to the canonical MSP dashboard', async () => {
    const request = new NextRequest('https://vanity.example.com/client-portal/dashboard', {
      headers: new Headers({ host: 'vanity.example.com' }),
    });
    (request as any).auth = {
      user: {
        user_type: 'internal',
      },
    };

    const response = await middleware(request);

    expect(response.headers.get('location')).toEqual('https://auth.example.com/msp/dashboard');
  });

  it('throws when NEXTAUTH_URL is missing for internal users hitting client portal routes', async () => {
    process.env.NEXTAUTH_URL = '';
    vi.resetModules();
    ({ default: middleware } = await import('server/src/middleware'));

    const request = new NextRequest('https://vanity.example.com/client-portal/dashboard', {
      headers: new Headers({ host: 'vanity.example.com' }),
    });
    (request as any).auth = {
      user: {
        user_type: 'internal',
      },
    };

    expect(() => middleware(request)).toThrow('NEXTAUTH_URL must be set');
  });
});
