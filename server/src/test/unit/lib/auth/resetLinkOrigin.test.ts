import { describe, expect, it } from 'vitest';
import { resolvePasswordResetOrigin } from '../../../../../../packages/auth/src/lib/resetLinkOrigin';

describe('resolvePasswordResetOrigin', () => {
  it('uses NEXT_PUBLIC_BASE_URL first and normalizes to the origin', () => {
    expect(
      resolvePasswordResetOrigin({
        NEXT_PUBLIC_BASE_URL: 'https://app.example.com',
        NEXTAUTH_URL: 'https://nextauth.example.com',
        HOST: 'host.example.com',
      })
    ).toBe('https://app.example.com');
  });

  it('strips a trailing slash and base path when normalizing', () => {
    expect(
      resolvePasswordResetOrigin({ NEXT_PUBLIC_BASE_URL: 'https://app.example.com/app/' })
    ).toBe('https://app.example.com');
  });

  it('falls back to NEXTAUTH_URL when NEXT_PUBLIC_BASE_URL is absent', () => {
    expect(
      resolvePasswordResetOrigin({ NEXTAUTH_URL: 'https://nextauth.example.com' })
    ).toBe('https://nextauth.example.com');
  });

  it('derives an https origin from a bare HOST hostname', () => {
    expect(resolvePasswordResetOrigin({ HOST: 'psa.example.com' })).toBe(
      'https://psa.example.com'
    );
  });

  it('accepts a HOST that already carries a scheme', () => {
    expect(resolvePasswordResetOrigin({ HOST: 'http://localhost:3614' })).toBe(
      'http://localhost:3614'
    );
  });

  it('normalizes a scheme-bearing HOST with a path to its origin', () => {
    expect(resolvePasswordResetOrigin({ HOST: 'https://x.example.com/path/' })).toBe(
      'https://x.example.com'
    );
  });

  it('never turns a scheme-bearing HOST into a bogus http/https-hostname origin', () => {
    for (const host of ['http://localhost:3614', 'https://x.example.com/path/', 'http://', 'https://']) {
      const origin = resolvePasswordResetOrigin({ HOST: host });
      if (origin) {
        const url = new URL(origin);
        expect(['http', 'https'], `HOST=${host}`).not.toContain(url.hostname);
      }
    }
  });

  it('refuses when every trusted source is absent or invalid', () => {
    expect(resolvePasswordResetOrigin({})).toBeNull();
    expect(
      resolvePasswordResetOrigin({ NEXT_PUBLIC_BASE_URL: 'not-a-url', HOST: 'not a host' })
    ).toBeNull();
  });

  it('never accepts a non-http(s) scheme', () => {
    expect(
      resolvePasswordResetOrigin({ NEXT_PUBLIC_BASE_URL: 'javascript:alert(1)' })
    ).toBeNull();
  });
});
