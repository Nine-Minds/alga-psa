/**
 * alga-2026-0002799: a custom host serves only the app(s) its portal_domains.surface allows.
 */
import { describe, expect, it } from 'vitest';
import { getCustomDomainSurfaceGateRedirect } from '../../middleware';
import type { PortalDomainSurface } from '@alga-psa/shared/core/portalDomainSurface';

const canonicalUrlEnv = new URL('https://algapsa.com');
const gate = (pathname: string, hostSurface: PortalDomainSurface | null, requestHostname = 'helpdesk.pbnj.ca') =>
  getCustomDomainSurfaceGateRedirect({
    pathname,
    search: '?a=1',
    requestHostname,
    canonicalUrlEnv,
    hostSurface,
    requestOrigin: `https://${requestHostname}`,
  })?.toString() ?? null;

describe('getCustomDomainSurfaceGateRedirect', () => {
  it('does not serve /client-portal/* or its auth pages on an msp host', () => {
    expect(gate('/client-portal/dashboard', 'msp')).toBe('https://helpdesk.pbnj.ca/msp/dashboard');
    expect(gate('/auth/client-portal/signin', 'msp')).toBe('https://helpdesk.pbnj.ca/auth/signin');
  });

  it('does not serve /msp/* or MSP auth pages on a client_portal host (redirects to canonical)', () => {
    expect(gate('/msp/dashboard', 'client_portal', 'portal.pbnj.ca')).toBe('https://algapsa.com/msp/dashboard?a=1');
    expect(gate('/auth/msp/signin', 'client_portal', 'portal.pbnj.ca')).toBe('https://algapsa.com/auth/msp/signin?a=1');
    expect(gate('/auth/signin', 'client_portal', 'portal.pbnj.ca')).toBe('https://algapsa.com/auth/signin?a=1');
  });

  it('serves both route families on a both host', () => {
    for (const path of ['/msp/dashboard', '/auth/signin', '/client-portal/dashboard', '/auth/client-portal/signin']) {
      expect(gate(path, 'both')).toBeNull();
    }
  });

  it('serves the matching family on single-surface hosts', () => {
    expect(gate('/msp/dashboard', 'msp')).toBeNull();
    expect(gate('/client-portal/dashboard', 'client_portal', 'portal.pbnj.ca')).toBeNull();
  });

  it('leaves /api/*, assets and the canonical host alone', () => {
    expect(gate('/api/auth/session', 'msp')).toBeNull();
    expect(gate('/api/v1/tickets', 'client_portal')).toBeNull();
    expect(gate('/_next/static/x.js', 'msp')).toBeNull();
    expect(gate('/msp/dashboard', null, 'algapsa.com')).toBeNull();
    expect(gate('/client-portal/dashboard', 'msp', 'algapsa.com')).toBeNull();
  });

  it('fails closed on lookup failure: portal-only legacy behaviour, MSP never opened', () => {
    expect(gate('/msp/dashboard', null)).toBe('https://algapsa.com/msp/dashboard?a=1');
    expect(gate('/auth/signin', null)).toBe('https://algapsa.com/auth/signin?a=1');
    expect(gate('/client-portal/dashboard', null)).toBeNull();
  });
});
