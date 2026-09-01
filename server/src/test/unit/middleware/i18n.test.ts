import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { i18nMiddleware, shouldSkipI18n } from '@/middleware/i18n';

/**
 * The middleware may hint at a locale but must never persist one.
 *
 * It runs in the edge runtime with no database access, so the only signal it
 * has is Accept-Language — a fallback, not a choice. Writing that guess to the
 * locale cookie made it indistinguishable from an explicit selection, and
 * getServerLocale() consults the cookie (step 1) ahead of the stored user,
 * client and tenant preferences. An English browser therefore pinned every
 * server-rendered string to English for a user configured as German.
 */

function request(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

function runMiddleware(req: NextRequest) {
  // The real default is NextResponse.next(); pass one explicitly so the test
  // does not depend on that static existing in the test stub.
  return i18nMiddleware(req, new NextResponse(null));
}

function localeCookieFrom(response: Response): string | null {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = /(?:^|,\s*)locale=([^;]*)/.exec(setCookie);
  return match ? match[1] : null;
}

describe('i18nMiddleware', () => {
  it('never writes the locale cookie', () => {
    const response = runMiddleware(
      request('http://localhost:3000/msp/tickets', { 'accept-language': 'en-US,en;q=0.9' }),
    );

    expect(localeCookieFrom(response)).toBeNull();
  });

  it('does not write the cookie even when its guess differs from the one already set', () => {
    // An unsupported cookie is ignored by detection, so the guess (fr) and the
    // cookie disagree — the case where the old code overwrote the cookie.
    const response = runMiddleware(
      request('http://localhost:3000/msp/tickets', {
        'accept-language': 'fr-FR,fr;q=0.9',
        cookie: 'locale=kl',
      }),
    );

    expect(localeCookieFrom(response)).toBeNull();
  });

  it('exposes the detected locale as a hint header', () => {
    const response = runMiddleware(
      request('http://localhost:3000/msp/tickets', { 'accept-language': 'de-DE,de;q=0.9' }),
    );

    expect(response.headers.get('x-locale')).toBe('de');
  });

  it('prefers an explicitly chosen cookie over the browser header for that hint', () => {
    const response = runMiddleware(
      request('http://localhost:3000/msp/tickets', {
        'accept-language': 'fr-FR,fr;q=0.9',
        cookie: 'locale=pl',
      }),
    );

    expect(response.headers.get('x-locale')).toBe('pl');
  });

  it('falls back to the default locale when the browser asks for nothing supported', () => {
    const response = runMiddleware(
      request('http://localhost:3000/msp/tickets', { 'accept-language': 'kl-GL,kl;q=0.9' }),
    );

    expect(response.headers.get('x-locale')).toBe('en');
  });

  it('varies on Accept-Language so a cached response cannot cross locales', () => {
    const response = runMiddleware(
      request('http://localhost:3000/msp/tickets', { 'accept-language': 'de-DE,de;q=0.9' }),
    );

    expect(response.headers.get('vary')).toContain('Accept-Language');
  });

  it('skips asset and API paths', () => {
    expect(shouldSkipI18n('/api/tickets')).toBe(true);
    expect(shouldSkipI18n('/_next/static/chunk.js')).toBe(true);
    expect(shouldSkipI18n('/msp/tickets')).toBe(false);
  });
});
