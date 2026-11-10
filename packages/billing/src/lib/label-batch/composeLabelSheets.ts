import {
  planLabelBatch,
  mmCss,
  LabelLayoutError,
  resolveLabelBatchPdfOptions,
  type LabelBatchGeometry,
  type LabelBatchLayout,
} from './layout';
import type { InvoicePdfPrintOptions } from '@alga-psa/types';
import { PDF_FONT_FACE_CSS } from '../pdf-fonts';

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
  /** Worksheets must not silently clip text, unlike intentionally compact tags. */
  validateTextFits?: boolean;
  /**
   * When true the cell is composed as a full-page flow section instead of an absolutely positioned
   * fixed-size cell: content taller than one page (a long ticket description on a customer worksheet)
   * flows onto continuation pages the way a regular document does, instead of being clipped or refused.
   */
  flow?: boolean;
  /**
   * A flow cell's page margin in mm (the template's `printSettings.marginMm`). It is the flow sheet's
   * real `@page` margin, so every continuation page keeps it; the cell's markup must not pad it again.
   */
  flowMarginMm?: number;
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
    // A flow section is bounded by its width only: its content may grow past one page and continues
    // onto continuation pages, so a designed height taller than the planned slot is not a refusal.
    const tooTall = designed && !cell.flow && designed.heightMm > placement.heightMm + TOLERANCE_MM;
    if (designed && (designed.widthMm > placement.widthMm + TOLERANCE_MM || tooTall)) {
      throw new LabelLayoutError(
        `${cell.description ?? `Label ${index + 1}`} is designed for ${designed.widthMm.toFixed(1)} x ` +
          `${designed.heightMm.toFixed(1)} mm but its label cell is ${placement.widthMm.toFixed(1)} x ` +
          `${placement.heightMm.toFixed(1)} mm.`
      );
    }
  });

  // Fixed cells fill the planned grid slots; each flow cell gets a sheet of its own so its pages
  // cannot collide with a neighbouring label. Input order is preserved across both kinds.
  // Each distinct flow margin gets its own named page, so fixed tags in the same batch keep the
  // zero-margin default page while worksheet pages carry their margin onto every continuation page.
  type Sheet = { flow: boolean; plannedSheet: number | null; pageName?: string; cells: string[] };
  const sheets: Sheet[] = [];
  const flowPages = new Map<string, { name: string; marginMm: number }>();
  cells.forEach((cell, index) => {
    const p = geometry.placements[index];
    const attrs = `data-label-index="${index}"${cell.validateTextFits ? ' data-validate-text-fits="true"' : ''}${cell.flow ? ' data-flow="true"' : ''}`;
    if (cell.flow) {
      const marginMm = Math.max(0, Math.min(cell.flowMarginMm ?? 0, p.widthMm / 4, p.heightMm / 4));
      const key = mmCss(marginMm);
      let page = flowPages.get(key);
      if (!page) {
        page = { name: `label-flow-${flowPages.size + 1}`, marginMm };
        flowPages.set(key, page);
      }
      sheets.push({
        flow: true,
        plannedSheet: p.sheet,
        pageName: page.name,
        cells: [`<div class="label-cell label-cell-flow" ${attrs}>${cell.html}</div>`],
      });
      return;
    }
    const last = sheets[sheets.length - 1];
    if (last && !last.flow && last.plannedSheet === p.sheet) {
      last.cells.push(
        `<div class="label-cell" ${attrs} style="left:${mmCss(p.leftMm)};top:${mmCss(p.topMm)};` +
          `width:${mmCss(p.widthMm)};height:${mmCss(p.heightMm)};">${cell.html}</div>`
      );
      return;
    }
    sheets.push({
      flow: false,
      plannedSheet: p.sheet,
      cells: [
        `<div class="label-cell" ${attrs} style="left:${mmCss(p.leftMm)};top:${mmCss(p.topMm)};` +
          `width:${mmCss(p.widthMm)};height:${mmCss(p.heightMm)};">${cell.html}</div>`,
      ],
    });
  });

  const css = Array.from(new Set(cells.map((cell) => cell.css).filter(Boolean))).join('\n');
  const pageSize = `${mmCss(geometry.pageWidthMm)} ${mmCss(geometry.pageHeightMm)}`;
  const flowPageCss = Array.from(flowPages.values())
    .map((page) => `@page ${page.name} { size: ${pageSize}; margin: ${mmCss(page.marginMm)}; }`)
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(options.title ?? 'Labels')}</title>
    <style>
${PDF_FONT_FACE_CSS}
${css}
@page { size: ${pageSize}; margin: 0; }
${flowPageCss}
html, body { margin: 0; padding: 0; background: #fff; }
.label-sheet { position: relative; width: ${mmCss(geometry.pageWidthMm)}; height: ${mmCss(geometry.pageHeightMm)}; overflow: hidden; break-after: page; page-break-after: always; }
.label-sheet:last-child { break-after: auto; page-break-after: auto; }
.label-cell { position: absolute; box-sizing: border-box; overflow: hidden; }
.label-sheet-flow { width: auto; height: auto; overflow: visible; }
.label-cell-flow { position: static; width: auto; overflow: visible; break-after: page; page-break-after: always; }
/* On a flow sheet the page box (size + margin) is the frame: the template's own page-sized root and
   single page section give up their fixed size so they fill the margin box instead of overrunning it. */
.label-cell-flow > .invoice-template-root > .ast-node-type-document,
.label-cell-flow > .invoice-template-root > .ast-node-type-document > .ast-node-type-section:only-child {
  width: auto !important; max-width: 100%; height: auto !important; min-height: 0 !important;
}
.label-cell-flow:last-child { break-after: auto; page-break-after: auto; }
    </style>
  </head>
  <body>
${sheets.map((sheet, i) => `<div class="label-sheet${sheet.flow ? ' label-sheet-flow' : ''}" data-sheet="${i}"${sheet.pageName ? ` style="page:${sheet.pageName};"` : ''}>${sheet.cells.join('')}</div>`).join('\n')}
  </body>
</html>`;

  return { html, geometry, printOptions: resolveLabelBatchPdfOptions(geometry) };
}
