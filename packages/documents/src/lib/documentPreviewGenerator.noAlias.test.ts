import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ uploadFile: vi.fn(), sharpImpl: vi.fn() }));

vi.mock('sharp', () => ({ default: (...a: unknown[]) => h.sharpImpl(...a) }));
vi.mock('@alga-psa/storage/StorageService', () => ({ StorageService: { uploadFile: h.uploadFile } }));
vi.mock('@alga-psa/storage/fileUploadTransaction', () => ({ deferFileUploadEvents: () => false }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ tenant: 'tenant-1' }),
  getTenantContext: () => 'tenant-1',
  tenantDb: vi.fn(),
}));
vi.mock('@alga-psa/auth/getCurrentUser', () => ({ getCurrentUser: async () => null }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/validation', () => ({ isValidUUID: () => false }));
vi.mock('@alga-psa/workflow-streams', () => ({
  buildMediaProcessingFailedPayload: vi.fn(),
  buildMediaProcessingSucceededPayload: vi.fn(),
}));
vi.mock('pdf-lib', () => ({ PDFDocument: {} }));
vi.mock('pdf2pic', () => ({ fromPath: vi.fn() }));

const ORIGINAL = 'original-file-id';
const doc = (mime: string) =>
  ({ document_id: 'doc-1', file_id: ORIGINAL, mime_type: mime, created_by: 'u1' }) as any;

/** sharp() stub: metadata + chainable resize/jpeg/toBuffer. */
function fakeSharp(opts: { width: number; height: number; failPreview?: boolean; failAll?: boolean }) {
  h.sharpImpl.mockImplementation(() => {
    const chain: any = {
      metadata: async () => {
        if (opts.failAll) throw new Error('unsupported image format');
        return { width: opts.width, height: opts.height };
      },
      resize: (w: number) => { chain._w = w; return chain; },
      jpeg: () => chain,
      toBuffer: async () => {
        if (opts.failPreview && chain._w === 800) throw new Error('boom');
        return Buffer.from('jpeg');
      },
    };
    return chain;
  });
}

const previewUpload = () => h.uploadFile.mock.calls.find((c) => c[3]?.metadata?.context === 'document_preview');

describe('generateDocumentPreviews never aliases the original upload', () => {
  beforeEach(() => {
    h.uploadFile.mockReset();
    let n = 0;
    h.uploadFile.mockImplementation(async () => ({ file_id: `derived-${++n}` }));
  });

  it('small SVG gets a distinct JPEG preview, not the original file id', async () => {
    fakeSharp({ width: 10, height: 10 });
    const { generateDocumentPreviews } = await import('./documentPreviewGenerator');
    const r = await generateDocumentPreviews(doc('image/svg+xml'), Buffer.from('<svg/>'));
    expect(r.preview_file_id).not.toBe(ORIGINAL);
    expect(r.preview_file_id).toMatch(/^derived-/);
    expect(previewUpload()?.[3]).toMatchObject({ mime_type: 'image/jpeg', origin: 'system-artifact' });
  });

  it('small SVG that sharp cannot convert yields null previews', async () => {
    // Thumbnail succeeds but the preview rasterisation throws (the old catch aliased the original).
    fakeSharp({ width: 10, height: 10, failPreview: true });
    const { generateDocumentPreviews } = await import('./documentPreviewGenerator');
    const r = await generateDocumentPreviews(doc('image/svg+xml'), Buffer.from('<svg/>'));
    expect(r.preview_file_id).toBeNull();
    expect(r.preview_file_id).not.toBe(ORIGINAL);
  });

  it('a sharp failure during preview yields null, not document.file_id', async () => {
    fakeSharp({ width: 100, height: 100, failPreview: true });
    const { generateDocumentPreviews } = await import('./documentPreviewGenerator');
    const r = await generateDocumentPreviews(doc('image/png'), Buffer.from('png'));
    expect(r.preview_file_id).toBeNull();
  });

  it('oversized PNG gets a distinct preview uploaded as image/jpeg', async () => {
    fakeSharp({ width: 4000, height: 3000 });
    const { generateDocumentPreviews } = await import('./documentPreviewGenerator');
    const r = await generateDocumentPreviews(doc('image/png'), Buffer.from('png'));
    expect(r.preview_file_id).toMatch(/^derived-/);
    expect(previewUpload()?.[3].mime_type).toBe('image/jpeg');
  });
});
