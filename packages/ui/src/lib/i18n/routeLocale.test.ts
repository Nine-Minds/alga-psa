// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A token-addressed route (the public quote review link) is written for the
 * token's recipient, so getServerLocale(), which the root layout uses for
 * <html lang>, must speak the recipient's language there, ahead of the session's
 * hierarchy and the browser's.
 */

const request = vi.hoisted(() => ({ pathname: null as string | null, acceptLanguage: null as string | null }));

vi.mock('next/headers.js', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({
    get: (name: string) =>
      name === 'x-pathname' ? request.pathname : name === 'accept-language' ? request.acceptLanguage : null,
  }),
}));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('@alga-psa/db/tenant', () => ({ getConnection: vi.fn() }));

const { getServerLocale, registerRouteLocaleResolver, registerServerLocaleResolver } = await import('./serverOnly');

const TOKEN_ROUTE = /^\/quote\/([A-Za-z0-9_-]{4})$/;
const routeResolver = vi.fn(async (match: RegExpMatchArray): Promise<string | null> => (match[1] === 'good' ? 'de' : null));

describe('route locale resolvers', () => {
  beforeEach(() => {
    request.pathname = null;
    request.acceptLanguage = 'fr-FR';
    routeResolver.mockClear();
    registerServerLocaleResolver(async () => 'es');
    registerRouteLocaleResolver(TOKEN_ROUTE, routeResolver);
  });

  it('uses the route resolver on a matching path, ahead of the session resolver', async () => {
    request.pathname = '/quote/good';
    await expect(getServerLocale()).resolves.toBe('de');
    expect(routeResolver).toHaveBeenCalledWith(expect.arrayContaining(['/quote/good', 'good']));
  });

  it('falls through to the session resolver when the route resolver returns null', async () => {
    request.pathname = '/quote/badd';
    await expect(getServerLocale()).resolves.toBe('es');
  });

  it('never runs the route resolver on other paths', async () => {
    request.pathname = '/client-portal/billing';
    await expect(getServerLocale()).resolves.toBe('es');
    expect(routeResolver).not.toHaveBeenCalled();
  });

  it('falls through when the route resolver throws', async () => {
    request.pathname = '/quote/good';
    routeResolver.mockRejectedValueOnce(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getServerLocale()).resolves.toBe('es');
    spy.mockRestore();
  });

  it('ignores an unsupported locale from the route resolver', async () => {
    request.pathname = '/quote/good';
    routeResolver.mockResolvedValueOnce('kl');
    await expect(getServerLocale()).resolves.toBe('es');
  });

  it('is not consulted when the caller passes explicit options', async () => {
    request.pathname = '/quote/good';
    await expect(getServerLocale({})).resolves.toBe('fr');
    expect(routeResolver).not.toHaveBeenCalled();
  });
});
