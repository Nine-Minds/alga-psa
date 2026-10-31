import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Kill-switch behaviour of every export entry point: FORCE_CAPABILITIES=co-managed:off must make the
// route a 404, the page notFound(), and the action not-found, before anything else is read.
const mocks = vi.hoisted(() => ({
  handler: vi.fn(async () => new Response('ARCHIVE')),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
  session: { user: { tenant: '11111111-1111-4111-8111-111111111111', user_type: 'internal', id: 'u' } } as any,
}));
vi.mock('@alga-psa/auth', () => ({ getSession: async () => mocks.session, withAuth: (fn: any) => (...args: any[]) => fn(mocks.session.user, { tenant: mocks.session.user.tenant }, ...args) }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@ee/lib/co-managed/portableExportHandler', () => ({ handleCoManagedPortableExport: mocks.handler, portableWorkspaceExportAvailability: { available: true } }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: async () => ({ t: (_k: string, o: any) => o?.defaultValue }) }));
vi.mock('@/components/co-managed/CoManagedPortableExport', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CoManagedFeatureBoundary', () => ({ CoManagedFeatureBoundary: () => null }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: vi.fn(async () => { throw new Error('db must not be touched'); }), tenantDb: vi.fn() }));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: vi.fn(async () => { throw new Error('actor must not be touched'); }) }));

const original = process.env.FORCE_CAPABILITIES;
beforeEach(() => { vi.clearAllMocks(); process.env.FORCE_CAPABILITIES = 'co-managed:off'; });
afterEach(() => { if (original === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = original; });

describe('portable export entry points with the capability forced off', () => {
  it('route answers the exact 404 of a missing record and never calls the handler', async () => {
    const { POST } = await import('../../../app/api/co-management/export/route');
    const response = await POST(new Request('http://localhost/api/co-management/export', { method: 'POST' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
    expect(mocks.handler).not.toHaveBeenCalled();
  });
  it('route also 404s without a tenant session or for a non-internal user, without calling the handler', async () => {
    delete process.env.FORCE_CAPABILITIES;
    const { POST } = await import('../../../app/api/co-management/export/route');
    const saved = mocks.session;
    for (const session of [{ user: null }, { user: { tenant: 't', user_type: 'client' } }]) {
      mocks.session = session;
      expect((await POST(new Request('http://localhost/x', { method: 'POST' }))).status).toBe(404);
    }
    mocks.session = saved; expect(mocks.handler).not.toHaveBeenCalled();
  });
  it('page calls notFound()', async () => {
    const page = (await import('../../../app/msp/co-management/export/page')).default;
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalled();
  });
  it('action is refused as not-found before any database or actor work', async () => {
    const { getCoManagedPortableExportScreenAction } = await import('../../../lib/actions/coManagedPortableExportActions');
    await expect((getCoManagedPortableExportScreenAction as any)()).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  });
});
