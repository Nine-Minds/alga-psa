import { describe, expect, it } from 'vitest';
import {
  HANDOFF_DEFAULT_RETURN_PATH,
  isPortalDomainHandoffTarget,
  normalizeHandoffReturnPath,
  surfaceForUserType,
} from '@alga-psa/shared/core/portalDomainSurface';

describe('isPortalDomainHandoffTarget (F006)', () => {
  it('is active AND serving the wanted surface', () => {
    expect(isPortalDomainHandoffTarget({ status: 'active', surface: 'both' }, 'msp')).toBe(true);
    expect(isPortalDomainHandoffTarget({ status: 'active', surface: 'both' }, 'client_portal')).toBe(true);
    expect(isPortalDomainHandoffTarget({ status: 'active', surface: 'msp' }, 'msp')).toBe(true);
    expect(isPortalDomainHandoffTarget({ status: 'active', surface: 'client_portal' }, 'client_portal')).toBe(true);
    // Legacy rows without a surface behave as client_portal.
    expect(isPortalDomainHandoffTarget({ status: 'active' }, 'client_portal')).toBe(true);
  });

  it('refuses a domain that does not serve the surface, or is not active', () => {
    expect(isPortalDomainHandoffTarget({ status: 'active', surface: 'msp' }, 'client_portal')).toBe(false);
    expect(isPortalDomainHandoffTarget({ status: 'active', surface: 'client_portal' }, 'msp')).toBe(false);
    expect(isPortalDomainHandoffTarget({ status: 'active' }, 'msp')).toBe(false);
    for (const status of ['pending_dns', 'verifying_dns', 'dns_failed', 'pending_certificate', 'certificate_issuing', 'certificate_failed', 'deploying', 'disabled']) {
      expect(isPortalDomainHandoffTarget({ status, surface: 'both' }, 'msp')).toBe(false);
    }
  });
});

describe('normalizeHandoffReturnPath (open-redirect guard)', () => {
  it('keeps relative paths inside the surface, with query and hash', () => {
    expect(normalizeHandoffReturnPath('/msp/dashboard', 'msp')).toBe('/msp/dashboard');
    expect(normalizeHandoffReturnPath('/msp/tickets?view=mine&page=2#top', 'msp')).toBe('/msp/tickets?view=mine&page=2#top');
    expect(normalizeHandoffReturnPath('/msp', 'msp')).toBe('/msp');
    expect(normalizeHandoffReturnPath('/client-portal/tickets', 'client_portal')).toBe('/client-portal/tickets');
  });

  it.each([
    undefined,
    null,
    42,
    '',
    'msp/dashboard',
    'https://evil.test/msp/dashboard',
    '//evil.test/msp/dashboard',
    '///evil.test',
    '/\\evil.test',
    '/msp\\..\\evil',
    '/msp/dashboard\r\nSet-Cookie: x=1',
    '/msp/dashboard\u0000',
    '/mspx/dashboard',
    '/msp/../client-portal/dashboard',
    '/msp/%2e%2e/%2e%2e/api/v1/users',
    '/client-portal/dashboard',
    '/api/auth/signout',
    '/auth/handoff?ott=x',
    `/msp/${'a'.repeat(3000)}`,
  ])('rejects %j for the MSP surface', (value) => {
    expect(normalizeHandoffReturnPath(value as unknown, 'msp')).toBeNull();
  });

  it('rejects MSP paths for the client portal surface', () => {
    expect(normalizeHandoffReturnPath('/msp/dashboard', 'client_portal')).toBeNull();
  });

  it('exposes the default landing page per surface (F010)', () => {
    expect(HANDOFF_DEFAULT_RETURN_PATH).toEqual({ client_portal: '/client-portal/dashboard', msp: '/msp/dashboard' });
  });
});

describe('surfaceForUserType', () => {
  it('maps client users to the portal and everyone else to the MSP app', () => {
    expect(surfaceForUserType('client')).toBe('client_portal');
    expect(surfaceForUserType('internal')).toBe('msp');
    expect(surfaceForUserType(undefined)).toBe('msp');
  });
});
