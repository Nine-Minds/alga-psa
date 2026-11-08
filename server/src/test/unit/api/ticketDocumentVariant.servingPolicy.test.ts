import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@alga-psa/db', async (orig) => ({ ...(await orig<any>()), runWithTenant: async (_t: string, cb: any) => cb() }));
vi.mock('server/src/lib/db', async (orig) => ({ ...(await orig<any>()), runWithTenant: async (_t: string, cb: any) => cb() }));

async function serve(mimeType: string | null, headers: Record<string, string> = {}) {
  const { ApiTicketController } = await import('server/src/lib/api/controllers/ApiTicketController');
  const c: any = Object.create(ApiTicketController.prototype);
  c.authenticate = async () => ({ context: { tenant: 't' }, url: 'http://localhost/api/v1/tickets/tk/documents/doc/preview' });
  c.checkPermission = async () => undefined;
  c.options = { permissions: {} };
  c.extractIdFromPath = async () => 'tk';
  c.assertTicketReadAllowed = async () => undefined;
  c.ticketService = { downloadTicketDocumentVariant: async () => ({ buffer: Buffer.from([1]), fileId: 'f1', mimeType }) };
  return c.downloadDocumentVariant('preview')(
    new NextRequest('http://localhost/api/v1/tickets/tk/documents/doc/preview', { headers })
  );
}

describe('v1 ticket document variant serving policy', { timeout: 90_000 }, () => {
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
    const nm = await serve('image/svg+xml', { 'if-none-match': '"f1"' });
    expect(nm.status).toBe(304);
    expect(nm.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
