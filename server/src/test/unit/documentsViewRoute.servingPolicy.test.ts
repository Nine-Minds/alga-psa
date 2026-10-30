import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ mime: 'image/png' }));
const getReadStream = vi.hoisted(() => vi.fn());

function record() {
  return { file_id: 'file-1', tenant: 'tenant-1', is_deleted: false, mime_type: state.mime, file_size: 100, storage_path: 'p' };
}
function knexMock() {
  return ((table: string) => {
    const b: any = {
      where: () => b, select: () => b, join: () => b, leftJoin: () => b, andWhere: () => b,
      first: () => Promise.resolve(table === 'external_files' ? record() : null),
    };
    return b;
  }) as any;
}

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: async () => ({ tenant: 'tenant-1', knex: knexMock() }),
  runWithTenant: async (_t: string, cb: () => Promise<unknown>) => cb(),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => knexMock() }));
vi.mock('@/lib/api/coManagedWorkspaceDenial', () => ({ coManagedWorkspaceDenial: async () => null }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => ({ user_id: 'u', tenant: 'tenant-1', user_type: 'internal' }) }));
vi.mock('@alga-psa/documents/actions/documentActions', () => ({ getAuthorizedDocumentByFileId: async () => ({ document_id: 'd' }) }));
vi.mock('server/src/lib/services/apiKeyServiceForApi', () => ({ ApiKeyServiceForApi: {} }));
vi.mock('@alga-psa/users/actions', () => ({ findUserByIdForApi: vi.fn() }));
vi.mock('@/lib/api/middleware/apiMiddleware', () => ({ assertInternalApiUser: vi.fn() }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any) => ({ table: (t: string) => conn(t), unscoped: (t: string) => conn(t) }),
  withTransaction: async (knex: any, cb: any) => cb(knex),
}));
vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: { createProvider: async () => ({ getReadStream }) },
  FileStoreModel: { findById: async () => record() },
}));

async function get(headers: Record<string, string> = {}) {
  const { GET } = await import('server/src/app/api/documents/view/[fileId]/route');
  return GET(new NextRequest('http://localhost/api/documents/view/file-1', { headers }), { params: Promise.resolve({ fileId: 'file-1' }) });
}

describe('documents view route serving policy', () => {
  beforeEach(() => {
    getReadStream.mockImplementation(async () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }));
  });

  it('serves SVG as an attachment with nosniff', async () => {
    state.mime = 'image/svg+xml';
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });

  it('serves PNG inline with the sandbox CSP', async () => {
    state.mime = 'image/png';
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline/);
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('applies policy headers to video range responses', async () => {
    state.mime = 'video/mp4';
    const res = await get({ range: 'bytes=0-9' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
  });

  it.each(['video/webm', 'video/mp4'])('allows media-src on full 200 and ranged 206 responses for %s', async (mime) => {
    state.mime = mime;
    for (const [headers, status] of [[{}, 200], [{ range: 'bytes=0-9' }, 206]] as const) {
      const res = await get({ ...headers });
      expect(res.status).toBe(status);
      expect(res.headers.get('Content-Disposition')).toMatch(/^inline/);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp).toContain("media-src 'self'");
      expect(csp).toContain('sandbox');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('still rejects non-servable types with 400', async () => {
    state.mime = 'text/html';
    expect((await get()).status).toBe(400);
  });
});
