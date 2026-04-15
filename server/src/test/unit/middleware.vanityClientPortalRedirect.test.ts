import { describe, expect, it } from 'vitest';

import { getVanityClientPortalInternalRedirectTarget } from 'server/src/middleware';

describe('getVanityClientPortalInternalRedirectTarget', () => {
  const canonicalUrlEnv = new URL('https://algapsa.com');

  it('redirects internal users from vanity client portal routes to the MSP dashboard', () => {
    const redirectTarget = getVanityClientPortalInternalRedirectTarget({
      pathname: '/client-portal/dashboard',
      isAuthPage: false,
      requestHostname: 'portal.nineminds.com',
      canonicalUrlEnv,
      userType: 'internal',
    });

    expect(redirectTarget?.toString()).toBe('https://algapsa.com/msp/dashboard');
  });

  it('redirects internal users from vanity client portal signin to the MSP dashboard', () => {
    const redirectTarget = getVanityClientPortalInternalRedirectTarget({
      pathname: '/auth/client-portal/signin',
      isAuthPage: true,
      requestHostname: 'portal.nineminds.com',
      canonicalUrlEnv,
      userType: 'internal',
    });

    expect(redirectTarget?.toString()).toBe('https://algapsa.com/msp/dashboard');
  });

  it('does not redirect client users on vanity client portal routes', () => {
    const redirectTarget = getVanityClientPortalInternalRedirectTarget({
      pathname: '/client-portal/dashboard',
      isAuthPage: false,
      requestHostname: 'portal.nineminds.com',
      canonicalUrlEnv,
      userType: 'client',
    });

    expect(redirectTarget).toBeNull();
  });

  it('does not redirect internal users on the canonical host', () => {
    const redirectTarget = getVanityClientPortalInternalRedirectTarget({
      pathname: '/client-portal/dashboard',
      isAuthPage: false,
      requestHostname: 'algapsa.com',
      canonicalUrlEnv,
      userType: 'internal',
    });

    expect(redirectTarget).toBeNull();
  });
});
