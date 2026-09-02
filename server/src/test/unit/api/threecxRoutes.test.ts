import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/telephony/threecxRouteDeps', () => ({
  buildThreecxRouteDeps: () => ({
    resolveTenantSlug: async () => null,
    checkRateLimit: async () => true,
    getProviderAvailability: async () => ({ enabled: true }),
    enqueueCanonicalCall: async () => undefined,
  }),
}));

const ROUTES_DIR = path.resolve(__dirname, '../../../app/api/telephony/3cx/[tenantSlug]');
const ROUTE_FILES = ['lookup', 'lookup-by-email', 'search', 'report-call'];

function params(tenantSlug: string) {
  return { params: Promise.resolve({ tenantSlug }) };
}

describe('3CX route files', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.EDITION;
    delete process.env.NEXT_PUBLIC_EDITION;
  });

  afterEach(() => {
    if (originalEdition === undefined) delete process.env.EDITION;
    else process.env.EDITION = originalEdition;
    if (originalPublicEdition === undefined) delete process.env.NEXT_PUBLIC_EDITION;
    else process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
  });

  it('T042: every route file imports the EE package and the CE stub helpers', () => {
    for (const segment of ROUTE_FILES) {
      const source = fs.readFileSync(path.join(ROUTES_DIR, segment, 'route.ts'), 'utf8');
      expect(source).toContain('@alga-psa/ee-threecx/lib');
      expect(source).toContain('_ceStub');
      expect(source).toContain('buildThreecxRouteDeps');
    }
  });

  it('T043: with EDITION unset, GET lookup answers 501', async () => {
    const mod = await import('@/app/api/telephony/3cx/[tenantSlug]/lookup/route');
    const res = await mod.GET(
      new NextRequest('https://example.test/api/telephony/3cx/abcdef012345/lookup?number=%2B15551234567'),
      params('abcdef012345'),
    );
    expect(res.status).toBe(501);
  });

  it('T044: with EDITION unset, POST report-call answers 501', async () => {
    const mod = await import('@/app/api/telephony/3cx/[tenantSlug]/report-call/route');
    const res = await mod.POST(
      new NextRequest('https://example.test/api/telephony/3cx/abcdef012345/report-call', { method: 'POST', body: '{}' }),
      params('abcdef012345'),
    );
    expect(res.status).toBe(501);
  });

  it('T045: OPTIONS answers 204 with the right Allow header', async () => {
    const lookup = await import('@/app/api/telephony/3cx/[tenantSlug]/lookup/route');
    const lookupRes = await lookup.OPTIONS();
    expect(lookupRes.status).toBe(204);
    expect(lookupRes.headers.get('Allow')).toContain('GET');

    const report = await import('@/app/api/telephony/3cx/[tenantSlug]/report-call/route');
    const reportRes = await report.OPTIONS();
    expect(reportRes.status).toBe(204);
    expect(reportRes.headers.get('Allow')).toContain('POST');
  });
});
