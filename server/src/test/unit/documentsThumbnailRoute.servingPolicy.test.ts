import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ mime: 'image/jpeg' }));

function knexMock() {
  return ((table: string) => {
    const builder: any = {
      where: () => builder,
      first: () => Promise.resolve(table === 'external_files'
        ? { file_id: 'thumb-1', is_deleted: false, mime_type: state.mime, storage_path: 'thumb' }
        : null),
    };
    return builder;
  }) as any;
}

vi.mock('server/src/lib/db', () => ({ createTenantKnex: async () => ({ tenant: 'tenant-1', knex: knexMock() }) }));
vi.mock('@/lib/api/coManagedWorkspaceDenial', () => ({ coManagedWorkspaceDenial: async () => null }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => ({ user_id: 'u', tenant: 'tenant-1' }) }));
vi.mock('@alga-psa/documents/lib/documentPermissions', () => ({ canReadDocument: async () => true }));
vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getAuthorizedDocumentById: async () => ({
    document_id: 'doc-1', thumbnail_file_id: 'thumb-1', preview_generated_at: new Date('2026-01-01T00:00:00Z'),
  }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any) => ({ table: (table: string) => conn(table) }),
  withTransaction: async (knex: any, callback: any) => callback(knex),
}));
vi.mock('@alga-psa/storage', () => ({
  StorageError: class extends Error {},
  StorageProviderFactory: { createProvider: async () => ({ download: async () => Buffer.from('<svg/>') }) },
}));

async function get(headers: Record<string, string> = {}) {
  const { GET } = await import('server/src/app/api/documents/[documentId]/thumbnail/route');
  return GET(new NextRequest('http://localhost/api/documents/doc-1/thumbnail', { headers }), {
    params: Promise.resolve({ documentId: 'doc-1' }),
  });
}

describe('documents thumbnail route serving policy', () => {
  beforeEach(() => { state.mime = 'image/jpeg'; });

  it.each(['image/svg+xml', 'text/html'])('neutralizes active content MIME %s on 200 and 304 responses', async (mime) => {
    state.mime = mime;
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');

    const notModified = await get({ 'if-none-match': '"thumb-1"' });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(notModified.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(notModified.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(notModified.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(notModified.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('keeps allowlisted raster thumbnails inline with nosniff on 200 and 304', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Content-Disposition')).toMatch(/^inline/);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const notModified = await get({ 'if-none-match': '"thumb-1"' });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('Content-Type')).toBe('image/jpeg');
    expect(notModified.headers.get('Content-Disposition')).toMatch(/^inline/);
    expect(notModified.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
