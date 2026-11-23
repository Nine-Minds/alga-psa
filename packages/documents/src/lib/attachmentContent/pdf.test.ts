import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import * as F from './__fixtures__/build';
import { fakeRenderer, fileSource } from './__fixtures__/sources';
import { DEFAULT_BUDGET, LIMITS, readAttachmentContent } from './index';

const run = async (sources: ReturnType<typeof fileSource>[], calls: number[][] = []) =>
  readAttachmentContent(sources, { docIndex: 0, unitIndex: 0 }, DEFAULT_BUDGET, {
    renderPdfPages: await fakeRenderer(() => F.png(600, 800), calls),
  });

const types = (r: { blocks: Array<{ type: string }> }) => r.blocks.map((b) => b.type);

describe('pdf producer', () => {
  it('born-digital 3-page PDF: original blob + 3 text pages, no rendering', async () => {
    const calls: number[][] = [];
    const bytes = F.bornDigitalPdf();
    const r = await run([fileSource('guide.pdf', 'application/pdf', bytes)], calls);
    expect(types(r)).toEqual(['text', 'resource', 'text', 'text', 'text', 'text', 'text', 'text']);
    const blob = r.blocks[1] as { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } };
    expect(blob.resource.mimeType).toBe('application/pdf');
    expect(Buffer.from(blob.resource.blob, 'base64').equals(bytes)).toBe(true);
    expect(blob.resource.uri).toBe('/api/documents/doc-guide.pdf/download');
    const texts = r.blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text);
    expect(texts).toContain('--- [1/1] guide.pdf page 1 of 3 (text layer) ---');
    expect(texts.join('\n')).toContain('Page two: configure the Citrix gateway.');
    expect(calls).toEqual([]);
    expect(r.served[0]).toMatchObject({ rendering: 'original+text', part: null, scanned_pages: [] });
    expect(r.next).toBeNull();
  });

  it('scanned 2-page PDF: each page rendered to a JPEG image', async () => {
    const calls: number[][] = [];
    const r = await run([fileSource('scan.pdf', 'application/pdf', F.scannedPdf())], calls);
    expect(types(r)).toEqual(['text', 'resource', 'text', 'image', 'text', 'image']);
    expect(calls).toEqual([[1], [2]]);
    const img = r.blocks[3] as { data: string; mimeType: string };
    expect(img.mimeType).toBe('image/png'); // fake renderer output is a small PNG: passed through unchanged
    expect((r.blocks[2] as { text: string }).text).toBe('--- [1/1] scan.pdf page 1 of 2 (no text layer; page image) ---');
    expect(r.served[0]).toMatchObject({ rendering: 'original+page_image', scanned_pages: [1, 2] });
  });

  it('rendered pages are bounded to a 1568 long edge and re-encoded as JPEG', async () => {
    const r = await readAttachmentContent([fileSource('scan.pdf', 'application/pdf', F.scannedPdf())], { docIndex: 0, unitIndex: 0 }, DEFAULT_BUDGET, {
      renderPdfPages: async (_p, pages) => Promise.all(pages.map(() => F.png(2000, 2600))),
    });
    const img = r.blocks.find((b) => b.type === 'image') as { data: string; mimeType: string };
    const meta = await sharp(Buffer.from(img.data, 'base64')).metadata();
    expect(img.mimeType).toBe('image/jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1568);
  });

  it('mixed PDF: text pages as text, the scanned page as an image', async () => {
    const calls: number[][] = [];
    const r = await run([fileSource('mixed.pdf', 'application/pdf', F.mixedPdf())], calls);
    expect(types(r)).toEqual(['text', 'resource', 'text', 'text', 'text', 'image', 'text', 'text']);
    expect(calls).toEqual([[2]]);
    expect(r.served[0]).toMatchObject({ rendering: 'original+text+page_image', scanned_pages: [2] });
  });

  it('encrypted PDF falls back with reason encrypted_pdf and no bytes', async () => {
    const bytes = fs.readFileSync(path.join(__dirname, '__fixtures__/encrypted.pdf'));
    const r = await run([fileSource('locked.pdf', 'application/pdf', bytes)]);
    expect(types(r)).toEqual(['text', 'resource_link']);
    expect(r.omitted).toEqual([expect.objectContaining({ name: 'locked.pdf', reason: 'encrypted_pdf' })]);
  });

  it('PDF over the 50 MiB cap is never downloaded (file_size checked first)', async () => {
    const loadBytes = vi.fn(async () => Buffer.alloc(0));
    const src = fileSource('big.pdf', 'application/pdf', Buffer.alloc(0), { fileSize: LIMITS.maxPdfBytes + 1, loadBytes });
    const r = await run([src]);
    expect(loadBytes).not.toHaveBeenCalled();
    expect(r.omitted[0]).toMatchObject({ reason: 'too_large' });
    expect(types(r)).toEqual(['text', 'resource_link']);
  });

  it('a corrupt PDF falls back as unreadable instead of failing the call', async () => {
    const r = await run([fileSource('junk.pdf', 'application/pdf', Buffer.from('%PDF-1.4 this is not a pdf'))]);
    expect(types(r)).toEqual(['text', 'resource_link']);
    expect(r.omitted[0].reason).toBe('unreadable');
  });

  it('a PDF above the blob size sends a resource_link, not a blob, and still returns page content', async () => {
    const big = Buffer.concat([F.bornDigitalPdf(), Buffer.alloc(LIMITS.pdfEmbedOriginalMaxBytes + 10, 0x20)]);
    const r = await run([fileSource('large.pdf', 'application/pdf', big)]);
    expect(types(r).slice(0, 2)).toEqual(['text', 'resource_link']);
    expect((r.blocks[0] as { text: string }).text).toContain('original_omitted: size');
    expect(types(r)).not.toContain('resource');
    expect(r.blocks.filter((b) => b.type === 'text').length).toBeGreaterThan(3);
  });

  it('a render failure on a scanned page is reported, not fatal', async () => {
    const r = await readAttachmentContent([fileSource('scan.pdf', 'application/pdf', F.scannedPdf())], { docIndex: 0, unitIndex: 0 }, DEFAULT_BUDGET, {
      renderPdfPages: async () => {
        throw new Error('PDF render timed out after 10000ms');
      },
    });
    expect((r.blocks[2] as { text: string }).text).toContain('page could not be rendered: PDF render timed out');
    expect(r.omitted.map((o) => o.reason)).toEqual(['page_render_failed', 'page_render_failed']);
    expect(r.next).toBeNull();
  });

  it('names the missing renderer in the page label when gm is not installed', async () => {
    const { PdfRendererMissingError } = await import('../graphicsMagickProbe');
    const r = await readAttachmentContent([fileSource('scan.pdf', 'application/pdf', F.scannedPdf())], { docIndex: 0, unitIndex: 0 }, DEFAULT_BUDGET, {
      renderPdfPages: async () => {
        throw new PdfRendererMissingError();
      },
    });
    expect((r.blocks[2] as { text: string }).text).toContain('GraphicsMagick (gm) is not installed');
    expect(r.omitted.map((o) => o.reason)).toEqual(['page_render_failed', 'page_render_failed']);
  });
});
