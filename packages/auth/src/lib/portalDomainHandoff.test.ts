import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T002 / T003 (alga-2026-0002996): computeVanityRedirect over an in-memory portal_domains /
// portal_domain_session_otts pair. The real OTT issuer runs against the fake, so a returned
// handoff URL is only ever backed by a stored OTT row, and "no OTT" is observable as no row.

type DomainRow = {
  id: string;
  tenant: string;
  domain: string;
  canonical_host: string;
  surface: string;
  status: string;
};

const state = vi.hoisted(() => ({
  portal_domains: [] as any[],
  portal_domain_session_otts: [] as any[],
}));

vi.mock('@alga-psa/core/logger', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: stub, logger: stub };
});

class FakeQuery {
  private filters: Array<(row: any) => boolean> = [];
  constructor(private readonly table: 'portal_domains' | 'portal_domain_session_otts') {}
  // tenantDb scopes with where(object) and/or where('table.tenant', value).
  where(criteria: Record<string, unknown> | string, value?: unknown) {
    const entries = typeof criteria === 'string' ? [[criteria, value] as const] : Object.entries(criteria);
    this.filters.push((row) => entries.every(([key, expected]) => row[key.split('.').pop() as string] === expected));
    return this;
  }
  first() {
    return state[this.table].find((row) => this.filters.every((f) => f(row)));
  }
  insert(data: any) {
    const row = { id: `ott-${state.portal_domain_session_otts.length + 1}`, created_at: new Date(), updated_at: new Date(), ...data };
    state[this.table].push(row);
    return { returning: () => [row] };
  }
}

const fakeKnex: any = (table: 'portal_domains' | 'portal_domain_session_otts') => new FakeQuery(table);

vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => fakeKnex }));

vi.mock('./PortalDomainModel', () => {
  const map = (row: any) => ({ id: row.id, tenant: row.tenant, domain: row.domain, canonicalHost: row.canonical_host, surface: row.surface, status: row.status });
  return {
    getPortalDomain: async (_knex: unknown, tenant: string) => {
      const row = state.portal_domains.find((r) => r.tenant === tenant);
      return row ? map(row) : null;
    },
    getPortalDomainByHostname: async (_knex: unknown, hostname: string) => {
      const row = state.portal_domains.find((r) => r.domain === hostname.toLowerCase());
      return row ? map(row) : null;
    },
  };
});

import { computeVanityRedirect } from './portalDomainHandoff';
import {
  __resetPortalDomainOttTestState,
  __setPortalDomainOttConnectionFactoryForTests,
} from './PortalDomainSessionToken';

const CANONICAL = 'https://app.alga.test';
const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';

const domainRow = (overrides: Partial<DomainRow> = {}): DomainRow => ({
  id: 'domain-1',
  tenant: TENANT,
  domain: 'msp.acme.test',
  canonical_host: 't1.portal.alga.test',
  surface: 'both',
  status: 'active',
  ...overrides,
});

const internalToken = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  tenant: TENANT,
  user_type: 'internal',
  login_method: 'google',
  ...overrides,
});

const clientToken = (overrides: Record<string, unknown> = {}) => ({
  id: 'client-user-1',
  tenant: TENANT,
  user_type: 'client',
  login_method: 'google',
  ...overrides,
});

beforeEach(() => {
  state.portal_domains = [domainRow()];
  state.portal_domain_session_otts = [];
  __setPortalDomainOttConnectionFactoryForTests(async () => fakeKnex);
});

afterEach(() => {
  __resetPortalDomainOttTestState();
});

describe('computeVanityRedirect: internal users (T002)', () => {
  it("issues an OTT recording the 'msp' surface and returns the custom host's handoff URL", async () => {
    const result = await computeVanityRedirect({
      url: 'https://msp.acme.test/msp/tickets?view=mine',
      baseUrl: CANONICAL,
      token: internalToken(),
    });

    expect(result).not.toBeNull();
    const url = new URL(result as string);
    expect(url.origin).toBe('https://msp.acme.test');
    expect(url.pathname).toBe('/auth/handoff');
    expect(url.searchParams.get('return')).toBe('/msp/tickets?view=mine');
    expect(url.searchParams.get('ott')).toBeTruthy();

    expect(state.portal_domain_session_otts).toHaveLength(1);
    const row = state.portal_domain_session_otts[0];
    expect(row.tenant).toBe(TENANT);
    expect(row.user_id).toBe('user-1');
    expect(row.portal_domain_id).toBe('domain-1');
    expect(row.metadata).toMatchObject({
      surface: 'msp',
      targetDomain: 'msp.acme.test',
      returnPath: '/msp/tickets?view=mine',
      loginMethod: 'google',
    });
    // The per-surface snapshot of user fields is gone: the session is minted at exchange time.
    expect(row.metadata.userSnapshot).toBeUndefined();
  });

  it('issues an OTT for an msp-only domain', async () => {
    state.portal_domains = [domainRow({ surface: 'msp' })];
    const result = await computeVanityRedirect({ url: 'https://msp.acme.test/msp/dashboard', baseUrl: CANONICAL, token: internalToken() });
    expect(result).toContain('/auth/handoff?ott=');
    expect(state.portal_domain_session_otts).toHaveLength(1);
  });

  it('keeps an internal user on the canonical host when the callback is a canonical path', async () => {
    const result = await computeVanityRedirect({ url: '/msp/dashboard', baseUrl: CANONICAL, token: internalToken() });
    expect(result).toBeNull();
    expect(state.portal_domain_session_otts).toHaveLength(0);
  });
});

describe('computeVanityRedirect guards (T003)', () => {
  it("never issues an OTT for another tenant's domain", async () => {
    state.portal_domains = [domainRow({ tenant: OTHER_TENANT })];
    const result = await computeVanityRedirect({ url: 'https://msp.acme.test/msp/dashboard', baseUrl: CANONICAL, token: internalToken() });
    expect(result).toBeNull();
    expect(state.portal_domain_session_otts).toHaveLength(0);
  });

  it.each(['pending_dns', 'deploying', 'certificate_failed', 'disabled'])('never issues an OTT for a %s domain', async (status) => {
    state.portal_domains = [domainRow({ status })];
    const result = await computeVanityRedirect({ url: 'https://msp.acme.test/msp/dashboard', baseUrl: CANONICAL, token: internalToken() });
    expect(result).toBeNull();
    expect(state.portal_domain_session_otts).toHaveLength(0);
  });

  it('never hands an internal user to a client_portal-only domain for an /msp path', async () => {
    state.portal_domains = [domainRow({ surface: 'client_portal' })];
    const result = await computeVanityRedirect({ url: 'https://msp.acme.test/msp/dashboard', baseUrl: CANONICAL, token: internalToken() });
    expect(result).toBeNull();
    expect(state.portal_domain_session_otts).toHaveLength(0);
  });

  it('never hands a client user to an msp-only domain', async () => {
    state.portal_domains = [domainRow({ surface: 'msp' })];
    const result = await computeVanityRedirect({ url: 'https://msp.acme.test/client-portal/dashboard', baseUrl: CANONICAL, token: clientToken() });
    expect(result).toBeNull();
    expect(state.portal_domain_session_otts).toHaveLength(0);
  });

  it('refuses return paths outside the MSP app (no open redirect, no cross-surface path)', async () => {
    for (const path of [
      '/client-portal/dashboard',
      '/api/v1/tickets',
      '/auth/handoff?ott=x',
      '/msp/../client-portal/dashboard',
      '/mspx/dashboard',
    ]) {
      const result = await computeVanityRedirect({ url: `https://msp.acme.test${path}`, baseUrl: CANONICAL, token: internalToken() });
      expect(result, path).toBeNull();
    }
    // Protocol-relative / backslash forms cannot reach the custom host's own path space.
    for (const url of ['//evil.test/msp/dashboard', 'https://msp.acme.test//evil.test/msp', 'https://msp.acme.test/\\evil.test']) {
      const result = await computeVanityRedirect({ url, baseUrl: CANONICAL, token: internalToken() });
      expect(result, url).toBeNull();
    }
    expect(state.portal_domain_session_otts).toHaveLength(0);
  });

  it('never targets a host that is not a registered portal domain', async () => {
    const result = await computeVanityRedirect({ url: 'https://evil.test/msp/dashboard', baseUrl: CANONICAL, token: internalToken() });
    expect(result).toBeNull();
    expect(state.portal_domain_session_otts).toHaveLength(0);
  });

  it('does not hand off for a non-interactive user type or an incomplete token', async () => {
    for (const token of [
      internalToken({ user_type: 'api' }),
      internalToken({ tenant: undefined }),
      internalToken({ id: undefined }),
    ]) {
      const result = await computeVanityRedirect({ url: 'https://msp.acme.test/msp/dashboard', baseUrl: CANONICAL, token });
      expect(result).toBeNull();
    }
    expect(state.portal_domain_session_otts).toHaveLength(0);
  });
});

describe('computeVanityRedirect: client users keep working (T003)', () => {
  it('hands a client user to the tenant client_portal domain from a canonical callback', async () => {
    state.portal_domains = [domainRow({ domain: 'portal.acme.test', surface: 'client_portal' })];
    const result = await computeVanityRedirect({ url: '/client-portal/tickets', baseUrl: CANONICAL, token: clientToken() });

    const url = new URL(result as string);
    expect(url.origin).toBe('https://portal.acme.test');
    expect(url.pathname).toBe('/auth/handoff');
    expect(url.searchParams.get('return')).toBe('/client-portal/tickets');
    expect(state.portal_domain_session_otts[0].metadata).toMatchObject({ surface: 'client_portal', targetDomain: 'portal.acme.test' });
  });

  it('hands a client user to a both domain addressed by host', async () => {
    const result = await computeVanityRedirect({ url: 'https://msp.acme.test/client-portal/dashboard', baseUrl: CANONICAL, token: clientToken() });
    expect(result).toContain('https://msp.acme.test/auth/handoff?ott=');
  });
});
