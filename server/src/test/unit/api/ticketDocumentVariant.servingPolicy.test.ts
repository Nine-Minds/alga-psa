import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authorizeResource = vi.hoisted(() => vi.fn(async () => ({ allowed: true, redactedFields: [] })));

vi.mock('@alga-psa/db', async (orig) => ({ ...(await orig<any>()), runWithTenant: async (_t: string, cb: any) => cb() }));
vi.mock('server/src/lib/db', async (orig) => ({ ...(await orig<any>()), runWithTenant: async (_t: string, cb: any) => cb() }));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => ({}) }));
vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: async () => ({ authorizeResource }),
}));

async function serve(mimeType: string | null, headers: Record<string, string> = {}) {
  const { ApiTicketController } = await import('server/src/lib/api/controllers/ApiTicketController');
  const { projectApiResourceRead } = await import('server/src/lib/api/controllers/authorizationKernel');
  const c: any = Object.create(ApiTicketController.prototype);
  c.authenticate = async () => ({
    context: { tenant: 't', user: { user_id: 'u', user_type: 'internal', tenant: 't' } },
    url: 'http://localhost/api/v1/tickets/tk/documents/doc/preview',
  });
  c.checkPermission = async () => undefined;
  c.options = { permissions: {} };
  c.extractIdFromPath = async () => 'tk';
  c.assertTicketReadAllowed = async () => projectApiResourceRead({
    knex: {} as any,
    tenant: 't',
    user: { user_id: 'u', user_type: 'internal', tenant: 't' },
    kind: 'ticket',
    record: { ticket_id: 'tk' },
  });
  c.ticketService = {
    getTicketDocuments: async () => [{ document_id: 'doc' }],
    downloadTicketDocumentVariant: async () => ({ buffer: Buffer.from([1]), fileId: 'f1', mimeType }),
  };
  return c.downloadDocumentVariant('preview')(
    new NextRequest('http://localhost/api/v1/tickets/tk/documents/doc/preview', { headers })
  );
}

describe('v1 ticket document variant serving policy', { timeout: 90_000 }, () => {
  beforeEach(() => authorizeResource.mockClear());

  it('serves an SVG variant as an attachment with nosniff and CSP', async () => {
    const res = await serve('image/svg+xml');
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
  });

  it('does not default an unknown MIME to image/jpeg', async () => {
    const res = await serve(null);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('serves JPEG inline and keeps policy headers on 304', async () => {
    const ok = await serve('image/jpeg');
    expect(ok.headers.get('Content-Disposition')).toMatch(/^inline/);
    expect(ok.headers.get('Content-Security-Policy')).toContain('sandbox');
    const svg = await serve('image/svg+xml');
    const etag = svg.headers.get('ETag');
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    const nm = await serve('image/svg+xml', { 'if-none-match': etag! });
    expect(nm.status).toBe(304);
    expect(nm.headers.get('ETag')).toBe(etag);
    expect(nm.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(nm.headers.get('Content-Disposition')).toMatch(/^attachment/);
    expect(nm.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(authorizeResource).toHaveBeenCalledTimes(3);
  });
});
