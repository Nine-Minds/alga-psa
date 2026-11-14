import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.hoisted(() => vi.fn());
const capabilityGuard = vi.hoisted(() => vi.fn());
const readArchiveFile = vi.hoisted(() => vi.fn());

vi.mock('server/src/app/api/auth/[...nextauth]/edge-auth', () => ({ auth: (handler: unknown) => handler }));
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));
vi.mock('@alga-psa/auth', () => ({ getSession }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: vi.fn(async () => ({ knex: {} })) }));
vi.mock('@alga-psa/core/capability/server', () => ({
  capabilityRouteGuard: capabilityGuard,
  notFoundResponse: () => Response.json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } }, { status: 404 }),
}));
vi.mock('@alga-psa/co-managed', () => ({ readCoManagedArchiveFile: readArchiveFile }));

import middleware from 'server/src/middleware';
import { GET } from 'server/src/app/api/co-management/archive-files/[archiveFileId]/route';

const user = { id: 'user-1', user_type: 'internal', tenant: 'tenant-1' };
const archiveFileId = '11111111-1111-4111-8111-111111111111';
type Middleware = (req: NextRequest) => Promise<Response>;

async function dispatch(url: string) {
  const req = Object.assign(new NextRequest(url), { auth: { user } });
  const edge = await (middleware as unknown as Middleware)(req);
  if (edge.headers.get('x-middleware-next') !== '1') return edge;
  return GET(new Request(url), { params: Promise.resolve({ archiveFileId }) });
}

describe('archive file handler through real middleware', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    vi.stubEnv('E2E_AUTH_BYPASS', 'false');
    getSession.mockResolvedValue({ session_id: 'session-1', user });
    capabilityGuard.mockResolvedValue(null);
    readArchiveFile.mockResolvedValue({ fileName: 'retained.txt', mimeType: 'text/plain', size: 3, body: new Uint8Array([111, 107, 10]) });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it('lets an authorized session reach the handler and receive the retained bytes', async () => {
    const response = await dispatch(`http://localhost:3000/api/co-management/archive-files/${archiveFileId}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok\n');
    expect(readArchiveFile).toHaveBeenCalledTimes(1);
  });

  it('keeps unauthenticated and capability-denied requests at the route default-deny response', async () => {
    getSession.mockResolvedValueOnce(null);
    const unauthenticated = await dispatch(`http://localhost:3000/api/co-management/archive-files/${archiveFileId}`);
    expect(unauthenticated.status).toBe(404);
    expect(readArchiveFile).not.toHaveBeenCalled();

    capabilityGuard.mockResolvedValueOnce(new Response('denied', { status: 404 }));
    const unauthorized = await dispatch(`http://localhost:3000/api/co-management/archive-files/${archiveFileId}`);
    expect(unauthorized.status).toBe(404);
    expect(readArchiveFile).not.toHaveBeenCalled();
  });

  it('keeps the exemption limited to archive-file ids and leaves unrelated API routes behind API-key auth', async () => {
    for (const path of [
      '/api/co-management/archive-files',
      `/api/co-management/archive-files/${archiveFileId}/extra`,
      '/api/co-management/archive-files-evil/anything',
    ]) {
      const response = await dispatch(`http://localhost:3000${path}`);
      expect(response.status, path).toBe(401);
      expect(await response.json()).toMatchObject({ error: 'Unauthorized: API key missing' });
    }
    expect(getSession).not.toHaveBeenCalled();
    const unrelated = await dispatch('http://localhost:3000/api/tickets/123');
    expect(unrelated.status).toBe(401);
    expect(readArchiveFile).not.toHaveBeenCalled();
  });
});
