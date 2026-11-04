import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  base: { baseUrl: 'https://app.example.com', source: 'canonical' } as { baseUrl: string; source: 'vanity' | 'canonical' },
  bySurface: {} as Record<string, { baseUrl: string; source: 'vanity' | 'canonical' }>,
}));

vi.mock('@alga-psa/tenancy/server', () => ({
  resolveTenantAppBase: vi.fn(async (_tenant: string, surface: string) => state.bySurface[surface] ?? state.base),
}));
vi.mock('../../models/PortalDomainModel', () => ({
  getPortalDomain: vi.fn(async () => ({ canonicalHost: 'abc.portal.example.com' })),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { resolveNotificationLinks } from './notificationLinkResolver';

const ORIGINAL = process.env.NEXTAUTH_URL;
beforeEach(() => {
  process.env.NEXTAUTH_URL = 'https://app.example.com/';
  state.bySurface = {};
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = ORIGINAL;
});

const input = { type: 'ticket' as const, ticketId: 'tk1' };

describe('resolveNotificationLinks custom-domain routing', () => {
  it('keeps canonical links when no custom domain applies', async () => {
    const links = await resolveNotificationLinks({} as any, '0123456789abcdef0123456789abcdef', input);
    expect(links.internalUrl).toBe('https://app.example.com/msp/tickets/tk1');
    expect(links.portalUrl).toMatch(/^https:\/\/abc\.portal\.example\.com\/client-portal\/tickets\/tk1\?tenant=/);
  });

  it('uses the MSP custom domain for internal links only', async () => {
    state.bySurface.msp = { baseUrl: 'https://msp.acme.test', source: 'vanity' };
    const links = await resolveNotificationLinks({} as any, '0123456789abcdef0123456789abcdef', input);
    expect(links.internalUrl).toBe('https://msp.acme.test/msp/tickets/tk1');
    expect(links.portalUrl).not.toContain('msp.acme.test');
  });

  it('uses the portal custom domain for client links without a tenant param', async () => {
    state.bySurface.client_portal = { baseUrl: 'https://portal.acme.test', source: 'vanity' };
    const links = await resolveNotificationLinks({} as any, '0123456789abcdef0123456789abcdef', input);
    expect(links.internalUrl).toBe('https://app.example.com/msp/tickets/tk1');
    expect(links.portalUrl).toBe('https://portal.acme.test/client-portal/tickets/tk1');
  });
});
