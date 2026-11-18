import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { renderPdfPages } from '../pdfPageRender';
import { LIMITS } from './limits';

/**
 * The default page renderer of one attachment: Ghostscript needs a file path, so the PDF is written to a
 * mkdtemp directory on first use and removed by the registered disposer when the call ends. Nothing is
 * written anywhere else.
 */
export function createPdfPageRenderer(onDispose: (fn: () => Promise<void>) => void) {
  let dir: string | undefined;
  let file: string | undefined;
  return async (pdf: Buffer, pages: readonly number[]): Promise<Buffer[]> => {
    if (!dir || !file) {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-pdf-'));
      const created = dir;
      onDispose(async () => {
        await fs.rm(created, { recursive: true, force: true }).catch(() => undefined);
      });
      file = path.join(dir, `${uuidv4()}.pdf`);
      await fs.writeFile(file, pdf);
    }
    const rendered = await renderPdfPages(file, pages, {
      dpi: LIMITS.pdfRenderDpi,
      maxEdgePx: LIMITS.imageMaxEdgePx,
      timeoutMs: LIMITS.pdfRenderTimeoutMs,
      saveDir: dir,
    });
    return rendered.map((r) => r.buffer);
  };
}
