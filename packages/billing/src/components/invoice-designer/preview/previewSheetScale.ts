/**
 * Zoom for the authoritative label preview sheet. A label is small enough to inspect enlarged, so 'fit'
 * grows it to fill the pane, bounded by the pane height and MAX_FIT_SCALE (and shrinks it in a pane
 * narrower than the label); '100%' shows it at CSS actual size (96 px per inch).
 */
export type PreviewZoomMode = 'fit' | 'actual';

export const MAX_FIT_SCALE = 4;
const MIN_SCALE = 0.1;

export interface PreviewSheetMetrics {
  widthPx: number;
  heightPx: number;
}

export const computePreviewSheetScale = (
  sheet: PreviewSheetMetrics,
  available: { widthPx: number; heightPx: number },
  mode: PreviewZoomMode
): number => {
  if (mode === 'actual' || sheet.widthPx <= 0 || sheet.heightPx <= 0) {
    return 1;
  }
  const scale = Math.min(available.widthPx / sheet.widthPx, available.heightPx / sheet.heightPx, MAX_FIT_SCALE);
  return Math.max(MIN_SCALE, Math.floor(scale * 100) / 100);
};

/** Read the sheet the server wrapped the preview in (see invoice-template-ast/previewSheet.ts). */
export const readPreviewSheetMetrics = (element: Element | null): PreviewSheetMetrics | null => {
  if (!element) return null;
  const widthPx = Number.parseFloat(element.getAttribute('data-sheet-width-px') ?? '');
  const heightPx = Number.parseFloat(element.getAttribute('data-sheet-height-px') ?? '');
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx)) return null;
  return { widthPx, heightPx };
};
