import { execFile } from 'child_process';

/** Thrown when page rendering cannot work on this host because the GraphicsMagick binary is absent. */
export class PdfRendererMissingError extends Error {
  readonly code = 'RENDERER_MISSING';
  constructor() {
    super('PDF page renderer unavailable: GraphicsMagick (gm) is not installed or not on PATH');
    this.name = 'PdfRendererMissingError';
  }
}

/** True when `gm` is missing (ENOENT). Any other outcome (including a non-zero exit) means it is present. */
export function isGraphicsMagickMissing(timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('gm', ['version'], { timeout: timeoutMs }, (error) => {
      resolve(Boolean(error) && (error as NodeJS.ErrnoException).code === 'ENOENT');
    });
  });
}
