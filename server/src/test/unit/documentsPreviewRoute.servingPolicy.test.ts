import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ mime: 'image/jpeg' }));

function knexMock() {
  return ((table: string) => {
    const b: any = {
      where: () => b,
      first: () => Promise.resolve(table === 'external_files'
        ? { file_id: 'prev-1', is_deleted: false, mime_type: state.mime, storage_path: 'p' }
        : null),
    };
    return b;
  }) as any;
}

vi.mock('server/src/lib/db', () => ({ createTenantKnex: async () => ({ tenant: 'tenant-1', knex: knexMock() }) }));
vi.mock('@/lib/api/coManagedWorkspaceDenial', () => ({ coManagedWorkspaceDenial: async () => null }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => ({ user_id: 'u', tenant: 'tenant-1' }) }));
vi.mock('@alga-psa/documents/lib/documentPermissions', () => ({ canReadDocument: async () => true }));
vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getAuthorizedDocumentById: async () => ({ document_id: 'd', preview_file_id: 'prev-1' }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any) => ({ table: (t: string) => conn(t) }),
  withTransaction: async (knex: any, cb: any) => cb(knex),
}));
vi.mock('@alga-psa/storage', () => ({
  StorageError: class extends Error {},
  StorageProviderFactory: { createProvider: async () => ({ download: async () => Buffer.from([1, 2]) }) },
}));

async function get(headers: Record<string, string> = {}) {
  const { GET } = await import('server/src/app/api/documents/[documentId]/preview/route');
  return GET(new NextRequest('http://localhost/api/documents/d/preview', { headers }), { params: Promise.resolve({ documentId: 'd' }) });
}

describe('documents preview route serving policy', () => {
  beforeEach(() => { state.mime = 'image/jpeg'; });

  it('neutralises a legacy SVG preview (octet-stream, attachment, nosniff, CSP)', async () => {
    state.mime = 'image/svg+xml';
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
  });

  it('serves a JPEG preview inline with nosniff', async () => {
    const res = await get();
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sends policy headers on the 304 too', async () => {
    state.mime = 'image/svg+xml';
    const res = await get({ 'if-none-match': '"prev-1"' });
    expect(res.status).toBe(304);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/);
  });
});
