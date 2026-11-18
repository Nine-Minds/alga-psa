import type { TemplatePreviewSheet } from './printSettings';

/**
 * Screen-only framing for the authoritative label preview: the rendered markup is placed on a sheet the
 * size of the label cell it prints in, so the author sees the label edge, the printable area and the
 * clipping the printer applies. Every rule sits under `@media screen`, so the frame can never reach paper.
 */

export const PREVIEW_SHEET_CLASS = 'alga-preview-sheet';
export const PREVIEW_SHEET_GUIDE_CLASS = 'alga-preview-sheet-guide';

const CSS_PX_PER_MM = 96 / 25.4;

const mm = (value: number): string => `${Math.round(value * 1000) / 1000}mm`;

export const previewSheetSizePx = (sheet: TemplatePreviewSheet): { widthPx: number; heightPx: number } => ({
  widthPx: Math.round(sheet.widthMm * CSS_PX_PER_MM * 100) / 100,
  heightPx: Math.round(sheet.heightMm * CSS_PX_PER_MM * 100) / 100,
});

export const buildPreviewSheetCss = (sheet: TemplatePreviewSheet): string => {
  const guide = sheet.guideMarginMm;
  const showGuide = guide > 0 && guide * 2 < Math.min(sheet.widthMm, sheet.heightMm);
  return `@media screen {
  html { background: #e5e7eb; }
  html body { margin: 0; padding: 24px; box-sizing: border-box; background: transparent; }
  .${PREVIEW_SHEET_CLASS} {
    position: relative;
    box-sizing: border-box;
    width: ${mm(sheet.widthMm)};
    height: ${mm(sheet.heightMm)};
    margin: 0 auto;
    background: #fff;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18), 0 8px 24px rgba(15, 23, 42, 0.12);
  }
  .${PREVIEW_SHEET_GUIDE_CLASS} {
    ${showGuide ? '' : 'display: none;'}
    position: absolute;
    left: ${mm(guide)};
    top: ${mm(guide)};
    width: ${mm(Math.max(0, sheet.widthMm - guide * 2))};
    height: ${mm(Math.max(0, sheet.heightMm - guide * 2))};
    box-sizing: border-box;
    border: 1px dashed rgba(99, 102, 241, 0.45);
    pointer-events: none;
    z-index: 2147483647;
  }
}
@media print {
  .${PREVIEW_SHEET_GUIDE_CLASS} { display: none; }
}`;
};

/** Wrap rendered body markup in the sheet. The size is exposed for the editor's zoom-to-fit. */
export const wrapInPreviewSheet = (html: string, sheet: TemplatePreviewSheet): string => {
  const { widthPx, heightPx } = previewSheetSizePx(sheet);
  return `<div class="${PREVIEW_SHEET_CLASS}" data-sheet-width-px="${widthPx}" data-sheet-height-px="${heightPx}">
<div class="${PREVIEW_SHEET_GUIDE_CLASS}" aria-hidden="true"></div>
${html}
</div>`;
};
