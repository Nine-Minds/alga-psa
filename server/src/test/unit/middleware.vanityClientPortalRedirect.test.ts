import { describe, expect, it } from 'vitest';

import {
  getClientPortalThemeRequestContext,
  getVanityClientPortalInternalRedirectTarget,
  hasContradictoryPortalIdentity,
} from 'server/src/middleware';

describe('getClientPortalThemeRequestContext', () => {
  it('preserves a vanity domain after the canonical auth redirect', () => {
    const context = getClientPortalThemeRequestContext(
      '/auth/client-portal/signin',
      new URLSearchParams({ portalDomain: 'Portal.Example.com' }),
    );

    expect(context).toEqual({
      isClientPortal: true,
      portalDomain: 'portal.example.com',
    });
  });

  it('preserves a tenant slug for hosted portal login links', () => {
    const context = getClientPortalThemeRequestContext(
      '/auth/client-portal/signin',
      new URLSearchParams({ tenant: 'A1B2C3D4E5F6' }),
    );

    expect(context).toEqual({
      isClientPortal: true,
      tenantSlug: 'a1b2c3d4e5f6',
    });
  });

  it('marks shared password-reset routes only for client portal requests', () => {
    expect(getClientPortalThemeRequestContext(
      '/auth/password-reset/set-new-password',
      new URLSearchParams({ portal: 'client', portalDomain: 'portal.example.com' }),
    )).toEqual({
      isClientPortal: true,
      portalDomain: 'portal.example.com',
    });

    expect(getClientPortalThemeRequestContext(
      '/auth/msp/signin',
      new URLSearchParams(),
    )).toEqual({ isClientPortal: false });
  });

  it('drops malformed public tenant hints', () => {
    expect(getClientPortalThemeRequestContext(
      '/auth/client-portal/signin',
      new URLSearchParams({ portalDomain: 'https://bad.example', tenant: '../tenant' }),
    )).toEqual({ isClientPortal: true });
  });
});

describe('hasContradictoryPortalIdentity', () => {
  it('rejects an internal-stamped identity carrying client scope', () => {
    expect(hasContradictoryPortalIdentity({
      user_type: 'internal',
      clientId: 'client-1',
      contactId: 'contact-1',
    })).toBe(true);
  });

  it('accepts correctly stamped internal and client identities', () => {
    expect(hasContradictoryPortalIdentity({ user_type: 'internal' })).toBe(false);
    expect(hasContradictoryPortalIdentity({
      user_type: 'client',
      clientId: 'client-1',
      contactId: 'contact-1',
    })).toBe(false);
  });
});

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
