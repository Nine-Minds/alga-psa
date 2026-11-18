import { LIMITS } from '../limits';
import { normalizeImage } from '../normalizeImage';
import { ProducerUnreadable, type AttachmentProducer, type AttachmentSource, type ContentUnit, type ProducerCtx, type UnitList } from '../types';
import { fallbackUnits } from './fallback';

/** The slice of pdf.js's page API the producer uses (keeps the unpdf types out of this module). */
interface PdfPage {
  getTextContent(): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
  cleanup?: () => void;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

function pageText(content: { items: Array<{ str?: string; hasEOL?: boolean }> }): string {
  return content.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const nonWhitespace = (s: string) => s.replace(/\s+/g, '').length;

async function openPdf(bytes: Buffer): Promise<PdfDocument> {
  const { getDocumentProxy } = await import('unpdf');
  try {
    // A copy: pdf.js transfers (detaches) the buffer it is given.
    // pdf.js font-eval code execution (CVE-2024-4367): never compile fonts with eval/Function. unpdf's type
    // omits the option, so it is passed through a cast; the bundled pdf.js (6.4.x) no longer reads it at all.
    const options = { isEvalSupported: false, verbosity: 0 } as Record<string, unknown>;
    return (await getDocumentProxy(new Uint8Array(bytes), options)) as unknown as PdfDocument;
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === 'PasswordException') throw new ProducerUnreadable('encrypted_pdf', 'the PDF is password protected');
    throw new ProducerUnreadable('unreadable', error instanceof Error ? error.message : String(error));
  }
}

/**
 * PDF units: unit 0 is the original file (a `resource` blob when it is small enough, else a
 * `resource_link`), then one unit per page: its text layer, or a rendered image when the page has none.
 */
export const pdfProducer: AttachmentProducer = {
  name: 'pdf',
  accepts: ['application/pdf'],
  maxBytes: LIMITS.maxPdfBytes,
  async units(source: AttachmentSource, bytes: Buffer, ctx: ProducerCtx): Promise<UnitList> {
    const pdf = await openPdf(bytes);
    ctx.onDispose(() => pdf.destroy().catch(() => undefined));
    const pages = pdf.numPages;
    const embed = LIMITS.pdfEmbedOriginal && bytes.length <= LIMITS.pdfEmbedOriginalMaxBytes;

    const original: ContentUnit = {
      cost: () => ({ images: 0, encodedBytes: embed ? Math.ceil(bytes.length / 3) * 4 : 0, textChars: 0 }),
      materialize: async () => {
        const mimeNote = ctx.mimeNote ? `, ${ctx.mimeNote}` : '';
        if (embed) {
          return {
            label: `${ctx.tag} (application/pdf, ${pages} page${pages === 1 ? '' : 's'}, original file attached below${mimeNote})`,
            blocks: [
              {
                type: 'resource',
                resource: { uri: ctx.documentUri(source.document.document_id), mimeType: 'application/pdf', blob: bytes.toString('base64') },
              },
            ],
            rendering: 'original',
          };
        }
        const link = await fallbackUnits(source, ctx, 'too_large').unit(0).materialize();
        return {
          label: `${ctx.tag} (application/pdf, ${pages} page${pages === 1 ? '' : 's'}): original file not attached (original_omitted: size); per-page content follows${mimeNote}.`,
          blocks: link.blocks,
          rendering: 'link',
        };
      },
    };

    const pageUnit = (pageNumber: number): ContentUnit => {
      // The text layer decides whether the page costs text or an image, so it is read once and shared by cost() and materialize().
      let analysis: Promise<string> | undefined;
      const readText = () =>
        (analysis ??= (async () => {
          const page = await pdf.getPage(pageNumber);
          try {
            return pageText(await page.getTextContent());
          } finally {
            page.cleanup?.();
          }
        })());
      const hasText = (text: string) => nonWhitespace(text) >= LIMITS.pdfMinTextChars;
      return {
        cost: async () => {
          const text = await readText();
          return hasText(text)
            ? { images: 0, encodedBytes: 0, textChars: Math.min(text.length, LIMITS.textChunkChars) }
            : { images: 1, encodedBytes: 0, textChars: 0 };
        },
        materialize: async () => {
          let text = await readText();
          if (hasText(text)) {
            let truncated = '';
            if (text.length > LIMITS.textChunkChars) {
              text = text.slice(0, LIMITS.textChunkChars);
              truncated = ', truncated';
            }
            return {
              label: `--- ${ctx.tag} page ${pageNumber} of ${pages} (text layer${truncated}) ---`,
              blocks: [{ type: 'text', text }],
              rendering: 'text',
              page: pageNumber,
            };
          }
          const label = `--- ${ctx.tag} page ${pageNumber} of ${pages} (no text layer; page image) ---`;
          try {
            const [png] = await ctx.renderPdfPages(bytes, [pageNumber]);
            const img = await normalizeImage(png);
            return {
              label,
              blocks: [{ type: 'image', data: img.data.toString('base64'), mimeType: img.mimeType }],
              rendering: 'page_image',
              page: pageNumber,
            };
          } catch (error) {
            const detail = (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 160);
            return {
              label: `--- ${ctx.tag} page ${pageNumber} of ${pages} (no text layer; page could not be rendered: ${detail}) ---`,
              blocks: [],
              rendering: 'page_image',
              page: pageNumber,
              omitted: { reason: 'page_render_failed' },
            };
          }
        },
      };
    };

    return {
      total: pages + 1,
      unit: (index) => (index === 0 ? original : pageUnit(index)),
      describeRange: (from, to) => {
        const first = Math.max(from, 1);
        const pageRange = to >= first ? (first === to ? `page ${first}` : `pages ${first}-${to}`) : null;
        if (from === 0 && to === pages) return null;
        if (!pageRange) return 'original file';
        return `${from === 0 ? 'original + ' : ''}${pageRange} of ${pages}`;
      },
    };
  },
};
