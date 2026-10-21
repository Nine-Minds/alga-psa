import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordPortalDomainSeen, getPortalDomainByHostname } = vi.hoisted(() => ({
  recordPortalDomainSeen: vi.fn(async () => undefined),
  getPortalDomainByHostname: vi.fn(),
}));

vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn(async () => ({})) }));
vi.mock('server/src/models/PortalDomainModel', () => ({ getPortalDomainByHostname }));
vi.mock('server/src/lib/portal-domains/portalDomainSeen', () => ({ recordPortalDomainSeen }));

import { GET } from 'server/src/app/api/portal-domain/surface/route';
import { getInternalLookupToken, INTERNAL_LOOKUP_HEADER } from 'server/src/lib/portal-domains/hostSurface';

function req(host: string, headers: Record<string, string> = {}) {
  const url = new URL('http://127.0.0.1:3000/api/portal-domain/surface');
  url.searchParams.set('host', host);
  return { nextUrl: url, headers: new Headers(headers) } as any;
}

describe('/api/portal-domain/surface last-seen recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = 'test-secret';
    delete process.env.AUTH_SECRET;
    getPortalDomainByHostname.mockResolvedValue({ status: 'active', surface: 'msp' });
  });

  it('returns the surface but does NOT record last-seen for an unauthenticated caller', async () => {
    const res = await GET(req('helpdesk.acme.com'));
    expect(await res.json()).toEqual({ surface: 'msp' });
    expect(recordPortalDomainSeen).not.toHaveBeenCalled();
  });

  it('does not record last-seen for a wrong token', async () => {
    await GET(req('helpdesk.acme.com', { [INTERNAL_LOOKUP_HEADER]: 'nope' }));
    expect(recordPortalDomainSeen).not.toHaveBeenCalled();
  });

  it('does not accept the raw auth secret as the token', async () => {
    await GET(req('helpdesk.acme.com', { [INTERNAL_LOOKUP_HEADER]: 'test-secret' }));
    expect(recordPortalDomainSeen).not.toHaveBeenCalled();
  });

  it('records last-seen for the middleware (HMAC-derived internal token)', async () => {
    const token = await getInternalLookupToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toBe('test-secret');
    await GET(req('helpdesk.acme.com', { [INTERNAL_LOOKUP_HEADER]: token as string }));
    expect(recordPortalDomainSeen).toHaveBeenCalledWith('helpdesk.acme.com');
  });

  it('never records when no secret is configured', async () => {
    const token = await getInternalLookupToken();
    delete process.env.NEXTAUTH_SECRET;
    expect(await getInternalLookupToken()).toBeNull();
    await GET(req('helpdesk.acme.com', { [INTERNAL_LOOKUP_HEADER]: token as string }));
    expect(recordPortalDomainSeen).not.toHaveBeenCalled();
  });

  it('does not record for hosts that are not active domains', async () => {
    getPortalDomainByHostname.mockResolvedValue(null);
    await GET(req('unknown.example.com', { [INTERNAL_LOOKUP_HEADER]: (await getInternalLookupToken()) as string }));
    expect(recordPortalDomainSeen).not.toHaveBeenCalled();
  });
});
