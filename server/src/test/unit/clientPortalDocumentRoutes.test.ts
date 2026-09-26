import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(), document: vi.fn(), downloadFile: vi.fn(), generatePDF: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: mocks.currentUser }));
vi.mock('@alga-psa/db', () => ({ runWithTenant: (_tenant: string, fn: () => Promise<unknown>) => fn() }));
vi.mock('@alga-psa/storage/StorageService', () => ({ StorageService: { downloadFile: mocks.downloadFile } }));
vi.mock('@alga-psa/client-portal/actions/client-portal-actions/client-documents', () => ({
  downloadClientDocument: mocks.document,
  getClientDocumentContent: mocks.document,
}));
vi.mock('@alga-psa/billing/services', () => ({ createPDFGenerationService: () => ({ generatePDF: mocks.generatePDF }) }));

import { GET as getFile } from '../../app/api/client-portal/documents/[documentId]/file/route';
import { GET as getExport } from '../../app/api/client-portal/documents/[documentId]/export/route';

const client = { user_id: 'client-user', tenant: 'tenant-a', user_type: 'client' };
const documentRecord = (overrides: Record<string, unknown> = {}) => ({
  document_id: 'doc-1', document_name: 'Meeting Notes', file_id: 'file-1', mime_type: 'application/pdf',
  ...overrides,
});
const request = (url: string) => new NextRequest(`http://localhost${url}`);
const params = { params: Promise.resolve({ documentId: 'doc-1' }) };

describe('client portal document routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue(client);
    mocks.document.mockResolvedValue(documentRecord());
    mocks.downloadFile.mockResolvedValue({ buffer: Buffer.from('%PDF-example'), metadata: { mime_type: 'application/pdf' } });
    mocks.generatePDF.mockResolvedValue(Buffer.from('%PDF-export'));
  });

  it('serves uploaded PDF inline with safe headers and exact bytes', async () => {
    const response = await getFile(request('/api/client-portal/documents/doc-1/file?disposition=inline'), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toContain('inline');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('%PDF-example');
  });

  it('serves uploaded images inline and uploaded files as named attachments', async () => {
    mocks.document.mockResolvedValueOnce(documentRecord({ mime_type: 'image/png', document_name: 'Diagram' }));
    mocks.downloadFile.mockResolvedValueOnce({ buffer: Buffer.from([137, 80, 78, 71]), metadata: { mime_type: 'image/png' } });
    const image = await getFile(request('/api/client-portal/documents/doc-1/file?disposition=inline'), params);
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(image.headers.get('Content-Disposition')).toContain('Diagram.png');
    expect(Array.from(new Uint8Array(await image.arrayBuffer()))).toEqual([137, 80, 78, 71]);

    const attachment = await getFile(request('/api/client-portal/documents/doc-1/file'), params);
    expect(attachment.headers.get('Content-Disposition')).toContain('attachment');
    expect(Buffer.from(await attachment.arrayBuffer()).toString()).toBe('%PDF-example');
  });

  it('returns JSON errors for missing files, unsupported inline types, and invisible documents', async () => {
    mocks.document.mockResolvedValueOnce(documentRecord({ file_id: null }));
    const noFile = await getFile(request('/api/client-portal/documents/doc-1/file'), params);
    expect(noFile.status).toBe(404);
    expect(await noFile.json()).toMatchObject({ code: 'no_file' });

    mocks.document.mockResolvedValueOnce(documentRecord({ mime_type: 'image/svg+xml' }));
    const svg = await getFile(request('/api/client-portal/documents/doc-1/file?disposition=inline'), params);
    expect(svg.status).toBe(415);

    mocks.document.mockResolvedValueOnce({ actionError: 'not visible' });
    const hidden = await getFile(request('/api/client-portal/documents/doc-1/file'), params);
    expect(hidden.status).toBe(404);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it('returns a visible JSON error when a previously uploaded storage object is missing', async () => {
    mocks.downloadFile.mockResolvedValueOnce(null);
    const response = await getFile(request('/api/client-portal/documents/doc-1/file'), params);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'missing_file' });
  });

  it('exports in-app Markdown content and generates PDF without writing a file', async () => {
    mocks.document.mockResolvedValueOnce({ document: documentRecord({ file_id: null }), content: { kind: 'block', blockData: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meeting Notes' }] }] } });
    const markdown = await getExport(request('/api/client-portal/documents/doc-1/export?format=md'), params);
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get('Content-Type')).toContain('text/markdown');
    expect(markdown.headers.get('Content-Disposition')).toContain('.md');
    expect(await markdown.text()).toContain('Meeting Notes');

    mocks.document.mockResolvedValueOnce({ document: documentRecord({ file_id: null }), content: { kind: 'block', blockData: [{ type: 'paragraph' }] } });
    const pdf = await getExport(request('/api/client-portal/documents/doc-1/export?format=pdf'), params);
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).toString()).toBe('%PDF-export');
    expect(mocks.generatePDF).toHaveBeenCalledWith({ documentId: 'doc-1', userId: 'client-user' });
  });

  it('denies internal and unauthenticated callers before looking up documents', async () => {
    mocks.currentUser.mockResolvedValueOnce({ ...client, user_type: 'internal' });
    expect((await getFile(request('/file'), params)).status).toBe(403);
    mocks.currentUser.mockResolvedValueOnce(null);
    expect((await getExport(request('/export?format=md'), params)).status).toBe(401);
    expect(mocks.document).not.toHaveBeenCalled();
  });
});
