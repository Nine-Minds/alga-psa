import {
  planLabelBatch,
  mmCss,
  LabelLayoutError,
  resolveLabelBatchPdfOptions,
  type LabelBatchGeometry,
  type LabelBatchLayout,
} from './layout';
import type { InvoicePdfPrintOptions } from '@alga-psa/types';

/**
 * One rendered label: body markup + the CSS that goes with it. The markup already carries the
 * template's print margin (the shared renderer pads the document root by `printSettings.marginMm`,
 * exactly as the designer preview does), so the cell adds no padding of its own: padding here too
 * would apply the margin twice and shrink the printable area by 2 x marginMm on each axis.
 */
export interface RenderedLabelCell {
  html: string;
  css: string;
  /** Size the template was designed for, in mm, when it declares one. */
  designedSizeMm?: { widthMm: number; heightMm: number } | null;
  /** For error messages only. */
  description?: string;
}

export interface ComposedLabelDocument {
  html: string;
  geometry: LabelBatchGeometry;
  printOptions: InvoicePdfPrintOptions;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TOLERANCE_MM = 0.05;

/**
 * Compose already rendered cells into ONE HTML document: one `.label-sheet` per page, each cell
 * absolutely positioned. Order is the input order. A template designed for a larger label than
 * its cell is rejected rather than clipped.
 */
export function composeLabelSheets(
  cells: readonly RenderedLabelCell[],
  layout: LabelBatchLayout,
  options: { title?: string } = {}
): ComposedLabelDocument {
  const geometry = planLabelBatch(layout, cells.length);

  cells.forEach((cell, index) => {
    const placement = geometry.placements[index];
    const designed = cell.designedSizeMm;
    if (
      designed &&
      (designed.widthMm > placement.widthMm + TOLERANCE_MM || designed.heightMm > placement.heightMm + TOLERANCE_MM)
    ) {
      throw new LabelLayoutError(
        `${cell.description ?? `Label ${index + 1}`} is designed for ${designed.widthMm.toFixed(1)} x ` +
          `${designed.heightMm.toFixed(1)} mm but its label cell is ${placement.widthMm.toFixed(1)} x ` +
          `${placement.heightMm.toFixed(1)} mm.`
      );
    }
  });

  const sheets: string[][] = Array.from({ length: geometry.sheets }, () => []);
  cells.forEach((cell, index) => {
    const p = geometry.placements[index];
    sheets[p.sheet].push(
      `<div class="label-cell" data-label-index="${index}" style="left:${mmCss(p.leftMm)};top:${mmCss(p.topMm)};` +
        `width:${mmCss(p.widthMm)};height:${mmCss(p.heightMm)};">${cell.html}</div>`
    );
  });

  const css = Array.from(new Set(cells.map((cell) => cell.css).filter(Boolean))).join('\n');
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(options.title ?? 'Labels')}</title>
    <style>
${css}
@page { size: ${mmCss(geometry.pageWidthMm)} ${mmCss(geometry.pageHeightMm)}; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.label-sheet { position: relative; width: ${mmCss(geometry.pageWidthMm)}; height: ${mmCss(geometry.pageHeightMm)}; overflow: hidden; break-after: page; page-break-after: always; }
.label-sheet:last-child { break-after: auto; page-break-after: auto; }
.label-cell { position: absolute; box-sizing: border-box; overflow: hidden; }
    </style>
  </head>
  <body>
${sheets.map((items, i) => `<div class="label-sheet" data-sheet="${i}">${items.join('')}</div>`).join('\n')}
  </body>
</html>`;

  return { html, geometry, printOptions: resolveLabelBatchPdfOptions(geometry) };
}
