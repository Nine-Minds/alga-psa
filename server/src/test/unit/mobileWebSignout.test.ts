import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alga-psa/auth', () => ({
  getSessionCookieName: () => 'authjs-port-3000.session-token',
}));

import { GET, sessionCookieNamesToClear } from '../../app/auth/mobile/signout/route';
import { validateMobileRedirectUri } from '../../lib/mobileAuth/redirectUri';

function request(url: string, cookie?: string): NextRequest {
  return new NextRequest(url, { headers: cookie ? { cookie } : {} });
}

function clearedCookies(response: Response): Map<string, string> {
  const out = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attrs] = header.split(';');
    const [name] = pair.split('=');
    out.set(name.trim(), attrs.join(';').toLowerCase());
  }
  return out;
}

describe('validateMobileRedirectUri', () => {
  it('accepts the app schemes on the expected landing path only', () => {
    expect(validateMobileRedirectUri('alga://auth/signed-out', 'signed-out')?.href).toBe('alga://auth/signed-out');
    expect(validateMobileRedirectUri('exp://192.168.1.20:8081/--/auth/signed-out', 'signed-out')).not.toBeNull();
    expect(validateMobileRedirectUri('https://algapsa.com/auth/signed-out', 'signed-out')).not.toBeNull();
    expect(validateMobileRedirectUri('alga://auth/callback', 'callback')).not.toBeNull();
  });

  it('rejects other schemes, other paths and the wrong landing for the kind', () => {
    expect(validateMobileRedirectUri('javascript://auth/signed-out', 'signed-out')).toBeNull();
    expect(validateMobileRedirectUri('alga://tickets', 'signed-out')).toBeNull();
    expect(validateMobileRedirectUri('alga://auth/callback', 'signed-out')).toBeNull();
    expect(validateMobileRedirectUri('alga://auth/signed-out', 'callback')).toBeNull();
    expect(validateMobileRedirectUri('not a url', 'signed-out')).toBeNull();
  });
});

describe('GET /auth/mobile/signout', () => {
  it('clears every session cookie variant and returns to the app', async () => {
    const response = await GET(
      request(
        'http://localhost:3000/auth/mobile/signout?redirect=alga%3A%2F%2Fauth%2Fsigned-out',
        'authjs-port-3000.session-token=abc; __Secure-authjs.session-token=def; authjs-port-3000.session-token.0=chunk; authjs.csrf-token=keep',
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('alga://auth/signed-out');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const cleared = clearedCookies(response);
    expect([...cleared.keys()].sort()).toEqual(
      ['__Secure-authjs.session-token', 'authjs-port-3000.session-token', 'authjs-port-3000.session-token.0'].sort(),
    );
    for (const attrs of cleared.values()) expect(attrs).toContain('max-age=0');
    expect(cleared.get('__Secure-authjs.session-token')).toContain('secure');
    expect(cleared.has('authjs.csrf-token')).toBe(false);
  });

  it('still clears the configured cookie when the browser sent none', () => {
    expect(sessionCookieNamesToClear([])).toEqual(['authjs-port-3000.session-token']);
  });

  it('falls back to the sign-in page for a missing or foreign redirect', async () => {
    const missing = await GET(request('http://localhost:3000/auth/mobile/signout'));
    expect(missing.headers.get('location')).toBe('http://localhost:3000/auth/signin');

    const foreign = await GET(
      request('http://localhost:3000/auth/mobile/signout?redirect=https%3A%2F%2Fevil.example%2Fauth%2Fcallback'),
    );
    expect(foreign.headers.get('location')).toBe('http://localhost:3000/auth/signin');
  });
});
