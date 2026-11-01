import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProductApiBehavior, resolveProductRouteBehavior } from '@/lib/productSurfaceRegistry';

/** L7a: route-level selection for the departure and archive surfaces (own hunks only). */
describe('L7a departure and archive route selection', () => {
  it('departure is reachable by both sides and closed to algadesk', () => {
    expect(resolveProductRouteBehavior('psa', '/msp/co-management/departure')).toBe('allowed');
    expect(resolveProductRouteBehavior('co_managed', '/msp/co-management/departure')).toBe('allowed');
    expect(resolveProductRouteBehavior('algadesk', '/msp/co-management/departure')).toBe('not_found');
  });

  it('the archive is MSP-only: a co_managed customer has none', () => {
    expect(resolveProductRouteBehavior('psa', '/msp/co-managed/archive')).toBe('allowed');
    expect(resolveProductRouteBehavior('co_managed', '/msp/co-managed/archive')).toBe('not_found');
    expect(resolveProductRouteBehavior('co_managed', '/msp/co-managed')).toBe('allowed');
  });

  it('the bytes route is denied to every product but psa', () => {
    expect(resolveProductApiBehavior('psa', '/api/co-management/archive-files/x')).toBe('allowed');
    expect(resolveProductApiBehavior('co_managed', '/api/co-management/archive-files/x')).toBe('denied');
    expect(resolveProductApiBehavior('algadesk', '/api/co-management/archive-files/x')).toBe('denied');
  });
});

const mocks = vi.hoisted(() => ({ session: null as any, guard: null as any, read: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({ getSession: async () => mocks.session }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: {} }) }));
vi.mock('@alga-psa/core/capability/server', () => ({
  capabilityRouteGuard: async () => mocks.guard,
  notFoundResponse: () => new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 }),
}));
vi.mock('@alga-psa/co-managed', () => ({ readCoManagedArchiveFile: mocks.read }));

describe('archive bytes route is 404 by default', () => {
  const call = async () => {
    const { GET } = await import('@/app/api/co-management/archive-files/[archiveFileId]/route');
    return GET(new Request('http://x'), { params: Promise.resolve({ archiveFileId: '55555555-5555-4555-8555-555555555555' }) });
  };
  beforeEach(() => { mocks.session = { session_id: 's', user: { id: 'u', tenant: 't', user_type: 'internal' } }; mocks.guard = null; mocks.read.mockReset(); });

  it('no session, a client-portal user, a closed capability, an unknown id and a thrown read are all the same 404', async () => {
    mocks.session = null; expect((await call()).status).toBe(404);
    mocks.session = { session_id: 's', user: { id: 'u', tenant: 't', user_type: 'client' } }; expect((await call()).status).toBe(404);
    mocks.session = { session_id: 's', user: { id: 'u', tenant: 't', user_type: 'internal' } };
    mocks.guard = new Response(null, { status: 404 }); expect((await call()).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.guard = null; mocks.read.mockResolvedValueOnce(null); expect((await call()).status).toBe(404);
    mocks.read.mockRejectedValueOnce(new Error('boom')); expect((await call()).status).toBe(404);
  });

  it('serves a manifest-listed file as a private, no-store attachment', async () => {
    mocks.read.mockResolvedValueOnce({ fileName: 'a b.pdf', mimeType: 'application/pdf', size: 3, body: new Uint8Array([1, 2, 3]) });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Disposition')).toContain("a%20b.pdf");
  });
});
