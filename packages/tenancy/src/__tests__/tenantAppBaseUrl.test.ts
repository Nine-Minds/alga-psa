import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  fail: false,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
  withOptionalAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async (tenantId?: string) => {
    if (state.fail) throw new Error('db down');
    const knex = (_table: string) => {
      const builder = {
        where(condition: Record<string, unknown>) {
          const rows = state.rows.filter((row) =>
            Object.entries(condition).every(([k, v]) => row[k] === v)
          );
          return { select: async () => rows };
        },
      };
      return builder;
    };
    return { knex, tenant: tenantId };
  }),
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where({ tenant }),
    unscoped: (t: string) => conn(t),
  }),
}));

import { getTenantAppBaseUrl } from '../server/tenantAppBaseUrl';

const ENV_KEYS = ['NEXTAUTH_URL', 'NEXT_PUBLIC_BASE_URL', 'HOST'] as const;
const saved: Record<string, string | undefined> = {};

function row(overrides: Record<string, unknown>) {
  return {
    tenant: 't1',
    domain: 'portal.acme.test',
    canonical_host: 'x.portal.test',
    surface: 'client_portal',
    status: 'active',
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NEXTAUTH_URL = 'https://app.example.com/';
  state.rows = [];
  state.fail = false;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('getTenantAppBaseUrl', () => {
  it('returns the canonical base (no trailing slash) when the tenant has no domain', async () => {
    expect(await getTenantAppBaseUrl('t1', 'msp')).toBe('https://app.example.com');
    expect(await getTenantAppBaseUrl('t1', 'client_portal')).toBe('https://app.example.com');
  });

  it('ignores domains that are not active', async () => {
    state.rows = [row({ surface: 'both', status: 'pending_dns' }), row({ surface: 'msp', status: 'pending_redirect_uri', domain: 'm.acme.test' })];
    expect(await getTenantAppBaseUrl('t1', 'msp')).toBe('https://app.example.com');
  });

  it('keeps MSP links canonical for a client_portal-only domain', async () => {
    state.rows = [row({ surface: 'client_portal' })];
    expect(await getTenantAppBaseUrl('t1', 'msp')).toBe('https://app.example.com');
    expect(await getTenantAppBaseUrl('t1', 'client_portal')).toBe('https://portal.acme.test');
  });

  it('uses an msp domain for msp but not for the client portal', async () => {
    state.rows = [row({ surface: 'msp', domain: 'msp.acme.test' })];
    expect(await getTenantAppBaseUrl('t1', 'msp')).toBe('https://msp.acme.test');
    expect(await getTenantAppBaseUrl('t1', 'client_portal')).toBe('https://app.example.com');
  });

  it('uses a both domain for either surface', async () => {
    state.rows = [row({ surface: 'both', domain: 'all.acme.test' })];
    expect(await getTenantAppBaseUrl('t1', 'msp')).toBe('https://all.acme.test');
    expect(await getTenantAppBaseUrl('t1', 'client_portal')).toBe('https://all.acme.test');
  });

  it('prefers the dedicated-surface domain over a both domain', async () => {
    state.rows = [
      row({ surface: 'both', domain: 'all.acme.test' }),
      row({ surface: 'msp', domain: 'msp.acme.test' }),
    ];
    expect(await getTenantAppBaseUrl('t1', 'msp')).toBe('https://msp.acme.test');
    expect(await getTenantAppBaseUrl('t1', 'client_portal')).toBe('https://all.acme.test');
  });

  it("does not leak another tenant's domain", async () => {
    state.rows = [row({ tenant: 't2', surface: 'both' })];
    expect(await getTenantAppBaseUrl('t1', 'msp')).toBe('https://app.example.com');
  });

  it('falls back to canonical when the lookup fails', async () => {
    state.fail = true;
    await expect(getTenantAppBaseUrl('t1', 'msp')).resolves.toBe('https://app.example.com');
  });

  it('falls back through NEXT_PUBLIC_BASE_URL, HOST, then empty', async () => {
    delete process.env.NEXTAUTH_URL;
    process.env.NEXT_PUBLIC_BASE_URL = 'https://pub.example.com';
    expect(await getTenantAppBaseUrl('t1', 'msp')).toBe('https://pub.example.com');
    delete process.env.NEXT_PUBLIC_BASE_URL;
    process.env.HOST = 'host.example.com';
    expect(await getTenantAppBaseUrl('t1', 'msp')).toBe('https://host.example.com');
    delete process.env.HOST;
    expect(await getTenantAppBaseUrl('t1', 'msp')).toBe('');
  });
});
