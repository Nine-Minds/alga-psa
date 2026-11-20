import { fromPath } from 'pdf2pic';
import { v4 as uuidv4 } from 'uuid';

/**
 * Renders PDF pages to raster images through pdf2pic (GraphicsMagick + Ghostscript).
 * Shared by document preview generation and the attachment content engine.
 *
 * Ghostscript hardening (-dSAFER): pdf2pic does not pass it. It drives GraphicsMagick
 * (`gm`, ImageMagick disabled), and GraphicsMagick's delegate for PDF runs `gs` itself.
 * Ghostscript has defaulted to SAFER since 9.50 (the server images ship 10.x), so file
 * access from a hostile PDF is refused unless a caller explicitly opts out. Nothing here does.
 */
export type PdfPageRenderOptions = {
  dpi: number;
  /** Where pdf2pic may write; the caller owns and removes the directory. */
  saveDir: string;
  /** Upper bound on ONE page render (pdf2pic cannot be aborted, so this only frees the caller). */
  timeoutMs: number;
} & (
  | { /** Fit inside a square of this edge, keeping the aspect ratio. */ maxEdgePx: number; width?: never; height?: never }
  | { maxEdgePx?: never; /** Exact output box (the page is stretched to it). */ width: number; height: number }
);

export interface RenderedPdfPage {
  page: number;
  buffer: Buffer;
}

/** Render one page; rejects with an ordinary Error on timeout or when nothing was produced. */
async function renderOne(pdfPath: string, page: number, opts: PdfPageRenderOptions): Promise<RenderedPdfPage> {
  const box =
    opts.maxEdgePx !== undefined
      ? { width: opts.maxEdgePx, height: opts.maxEdgePx, preserveAspectRatio: true }
      : { width: opts.width, height: opts.height };
  const converter = fromPath(pdfPath, {
    density: opts.dpi,
    saveFilename: uuidv4(),
    savePath: opts.saveDir,
    format: 'png',
    ...box,
  });
  // pdf2pic cannot be aborted, so the race only frees the caller.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const rendered = await Promise.race([
    converter(page, { responseType: 'buffer' }),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`PDF render timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
  if (!rendered || !rendered.buffer) {
    throw new Error('Failed to render PDF page');
  }
  return { page, buffer: rendered.buffer as Buffer };
}

/** Render `pages` (1-based) of the PDF at `pdfPath`, one at a time, each under its own timeout. */
export async function renderPdfPages(
  pdfPath: string,
  pages: readonly number[],
  opts: PdfPageRenderOptions,
): Promise<RenderedPdfPage[]> {
  const out: RenderedPdfPage[] = [];
  for (const page of pages) {
    out.push(await renderOne(pdfPath, page, opts));
  }
  return out;
}
