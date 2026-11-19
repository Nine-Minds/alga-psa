import { createRequire } from 'node:module';
import path from 'node:path';

import { browserPoolService } from '../../services/browserPoolService';
import { PREVIEW_SHEET_CLASS, PREVIEW_SHEET_GUIDE_CLASS, previewSheetSizePx } from './previewSheet';
import {
  DOCUMENT_PRINT_GEOMETRY_RULES,
  resolveDocumentPrintGeometryFromAst,
  type DocumentPrintGeometry,
} from './printSettings';

/**
 * The on-screen preview of a page document, drawn as the pages it prints as.
 *
 * The author sees discrete sheets at the template's page size, each showing its printable area, with
 * the content distributed exactly the way the PDF distributes it — a new sheet on every forced break
 * and on natural overflow. Not one endless column.
 *
 * Pagination runs SERVER-SIDE, in the same pooled Chromium the PDF is printed by, fed the same print
 * HTML and the same `@page` geometry (resolveDocumentPrintGeometryFromAst). Doing it in the author's
 * browser would let a non-Chromium browser show a pagination that disagrees with print, which is the
 * one failure mode that makes this feature worse than the single roll. paged.js is the chunker and is
 * injected into the headless page from disk: it is never imported by this package and never reaches
 * the client bundle.
 *
 * Every sheet, guide and caption this module adds is screen-only framing — see previewSheet.ts — and
 * no PDF path ever calls it.
 */

const PREVIEW_PAGE_CLASS = 'alga-preview-page';
const PREVIEW_CAPTION_CLASS = 'alga-preview-page-caption';
const BREAK_BEFORE_CLASS = 'alga-chunk-break-before';
const BREAK_AFTER_CLASS = 'alga-chunk-break-after';
const BREAK_INSIDE_CLASS = 'alga-chunk-break-inside-avoid';

/**
 * paged.js collects forced breaks from stylesheet RULES, by selector, before it lays anything out —
 * an inline `style="break-before: page"` (which is how the designer writes every break it authors)
 * is invisible to it. So each element whose computed style forces a break is tagged with a class
 * these rules select, and the breaks the author drew become breaks the chunker can see.
 */
const BREAK_CLASS_CSS = `.${BREAK_BEFORE_CLASS} { break-before: page; }
.${BREAK_AFTER_CLASS} { break-after: page; }
.${BREAK_INSIDE_CLASS} { break-inside: avoid; }`;

/**
 * Where paged.js keeps the polyfill bundle. Resolved from the package entry, because the package's
 * `exports` map hides the dist path. Resolved twice over: from this module in a plain Node process,
 * and from the app root when this module has been bundled somewhere node_modules is not a sibling.
 */
const resolvePagedPolyfillPath = (): string => {
  const roots = [import.meta.url, path.join(process.cwd(), 'package.json')];
  for (const root of roots) {
    try {
      // pagedjs → <root>/lib/index.cjs
      const packageRoot = path.resolve(path.dirname(createRequire(root).resolve('pagedjs')), '..');
      return path.join(packageRoot, 'dist', 'paged.polyfill.min.js');
    } catch {
      // Try the next root.
    }
  }
  throw new Error('pagedjs is not installed: the preview cannot be drawn as pages.');
};

export interface PaginatePreviewOptions {
  geometry: DocumentPrintGeometry;
  /** Locale for the screen-only "Page n of N" caption. */
  locale?: string;
}

export interface PaginatedPreview {
  html: string;
  /** Sheets drawn, or 0 when the headless pass failed and `html` is the unpaginated document. */
  pageCount: number;
}

const buildPaginationCss = (geometry: DocumentPrintGeometry): string => {
  const { widthPx, heightPx } = previewSheetSizePx({
    widthMm: geometry.pageWidthMm,
    heightMm: geometry.pageHeightMm,
    guideMarginMm: geometry.marginMm,
  });
  return `@page { size: ${geometry.pageWidthMm}mm ${geometry.pageHeightMm}mm; margin: ${geometry.marginMm}mm; }
/* The print geometry, unscoped: paged.js lays the flow out in screen media, so the rules that give a
   printed document its one page box have to apply here too or the sheets would not match the PDF. */
${DOCUMENT_PRINT_GEOMETRY_RULES}
/* Sheet size is stated for the frame's zoom-to-fit: ${widthPx}x${heightPx} CSS px. */`;
};

/** Screen-only framing for the paginated sheets, appended after paged.js has injected its own CSS. */
const buildPaginatedSheetCss = (geometry: DocumentPrintGeometry): string => {
  const guide = geometry.marginMm;
  const showGuide = guide > 0 && guide * 2 < Math.min(geometry.pageWidthMm, geometry.pageHeightMm);
  return `@media screen {
  html { background: #e5e7eb; }
  html body { margin: 0; padding: 24px; box-sizing: border-box; background: transparent; }
  .pagedjs_pages { display: block; width: auto; height: auto; max-width: none; }
  .${PREVIEW_PAGE_CLASS} { display: block; width: auto; height: auto; margin: 0; padding: 0; }
  .${PREVIEW_PAGE_CLASS} + .${PREVIEW_PAGE_CLASS} { margin-top: 24px; }
  .${PREVIEW_SHEET_CLASS} {
    position: relative;
    box-sizing: border-box;
    width: ${geometry.pageWidthMm}mm;
    height: ${geometry.pageHeightMm}mm;
    margin: 0 auto;
    background: #fff;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18), 0 8px 24px rgba(15, 23, 42, 0.12);
  }
  .${PREVIEW_SHEET_GUIDE_CLASS} {
    ${showGuide ? '' : 'display: none;'}
    position: absolute;
    left: ${guide}mm;
    top: ${guide}mm;
    width: ${Math.max(0, geometry.pageWidthMm - guide * 2)}mm;
    height: ${Math.max(0, geometry.pageHeightMm - guide * 2)}mm;
    box-sizing: border-box;
    border: 1px dashed rgba(99, 102, 241, 0.45);
    pointer-events: none;
    z-index: 2147483647;
  }
  .${PREVIEW_CAPTION_CLASS} {
    margin: 6px auto 0;
    text-align: center;
    font: 500 11px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #64748b;
  }
}
@media print {
  .${PREVIEW_SHEET_GUIDE_CLASS}, .${PREVIEW_CAPTION_CLASS} { display: none; }
}`;
};

/**
 * Turn a rendered print HTML document into the same document drawn as its printed pages.
 * Returns the original HTML unchanged if the headless pass fails — a single roll beats no preview.
 */
export const paginateTemplatePreviewHtml = async (
  html: string,
  options: PaginatePreviewOptions,
): Promise<PaginatedPreview> => {
  const { geometry } = options;
  const sheetSize = previewSheetSizePx({
    widthMm: geometry.pageWidthMm,
    heightMm: geometry.pageHeightMm,
    guideMarginMm: geometry.marginMm,
  });

  let browser = null;
  try {
    browser = await browserPoolService.getBrowser();
    const page = await browser.newPage();
    try {
      // Chunk in print media: the fragmentation hints that keep a table row, a totals block or a
      // heading whole live in `@media print`, and a preview chunked without them would break where
      // the PDF does not.
      await page.emulateMediaType('print');
      await page.setContent(html, { waitUntil: 'load' });
      await page.addStyleTag({ content: buildPaginationCss(geometry) });
      await page.addStyleTag({ content: BREAK_CLASS_CSS });
      await page.evaluate(
        (classes) => {
          const forced = (value: string) => value === 'page' || value === 'always' || value === 'left' || value === 'right';
          const avoided = (value: string) => value === 'avoid' || value === 'avoid-page';
          document.querySelectorAll<HTMLElement>('body *').forEach((element) => {
            const style = window.getComputedStyle(element);
            if (forced(style.breakBefore)) element.classList.add(classes.before);
            if (forced(style.breakAfter)) element.classList.add(classes.after);
            if (avoided(style.breakInside)) element.classList.add(classes.inside);
          });
        },
        { before: BREAK_BEFORE_CLASS, after: BREAK_AFTER_CLASS, inside: BREAK_INSIDE_CLASS },
      );
      // Set before the polyfill loads, or it chunks the document on its own schedule.
      await page.evaluate(() => {
        (window as unknown as { PagedConfig: unknown }).PagedConfig = { auto: false };
      });
      await page.addScriptTag({ path: resolvePagedPolyfillPath() });
      await page.evaluate(async () => {
        const polyfill = (window as unknown as { PagedPolyfill: { preview: () => Promise<unknown> } }).PagedPolyfill;
        await polyfill.preview();
      });

      const pageCount = await page.evaluate(
        (classes) => {
          const pages = Array.from(document.querySelectorAll<HTMLElement>('.pagedjs_page'));
          // A forced break on the last node opens a page paged.js then has nothing to put on. The
          // printed document drops it (react-renderer's trailing-break reset); so does the preview.
          while (pages.length > 1) {
            const last = pages[pages.length - 1];
            const content = last.querySelector<HTMLElement>('.pagedjs_page_content');
            const isBlank =
              !content ||
              ((content.textContent ?? '').trim() === '' && content.querySelector('img, svg, canvas') === null);
            if (!isBlank) break;
            last.remove();
            pages.pop();
          }
          pages.forEach((pageElement) => pageElement.classList.add(classes.page));
          return pages.length;
        },
        { page: PREVIEW_PAGE_CLASS },
      );

      const captions = await buildPageCaptions(pageCount, options.locale);

      await page.evaluate(
        (input) => {
          const pages = Array.from(document.querySelectorAll<HTMLElement>(`.${input.classes.page}`));
          pages.forEach((pageElement, index) => {
            const sheet = pageElement.querySelector<HTMLElement>('.pagedjs_sheet') ?? pageElement;
            sheet.classList.add(input.classes.sheet);
            sheet.setAttribute('data-sheet-width-px', String(input.sheet.widthPx));
            sheet.setAttribute('data-sheet-height-px', String(input.sheet.heightPx));
            sheet.setAttribute('data-preview-page', String(index + 1));
            sheet.setAttribute('data-preview-page-total', String(pages.length));
            const guide = document.createElement('div');
            guide.className = input.classes.guide;
            guide.setAttribute('aria-hidden', 'true');
            sheet.appendChild(guide);
            const caption = input.captions[index];
            if (caption) {
              const captionElement = document.createElement('div');
              captionElement.className = input.classes.caption;
              captionElement.textContent = caption;
              pageElement.appendChild(captionElement);
            }
          });
        },
        {
          classes: {
            page: PREVIEW_PAGE_CLASS,
            sheet: PREVIEW_SHEET_CLASS,
            guide: PREVIEW_SHEET_GUIDE_CLASS,
            caption: PREVIEW_CAPTION_CLASS,
          },
          sheet: sheetSize,
          captions,
        },
      );

      // Last, so the framing wins the cascade over paged.js's own sheet rules.
      await page.addStyleTag({ content: buildPaginatedSheetCss(geometry) });
      return { html: await page.content(), pageCount };
    } finally {
      await page.close();
    }
  } catch (error) {
    console.error('Failed to paginate the template preview:', error);
    return { html, pageCount: 0 };
  } finally {
    await browserPoolService.releaseBrowser(browser);
  }
};

const buildPageCaptions = async (pageCount: number, locale: string | undefined): Promise<string[]> => {
  let translate: (page: number, total: number) => string = (page, total) => `Page ${page} of ${total}`;
  try {
    const [{ getServerTranslation }, { normalizeLocale }] = await Promise.all([
      import('@alga-psa/ui/lib/i18n/serverOnly'),
      import('@alga-psa/core/i18n/config'),
    ]);
    const { t } = await getServerTranslation(normalizeLocale(locale) ?? undefined, 'msp/invoicing');
    translate = (page, total) =>
      String(t('designer.workspace.preview.pageCaption', { defaultValue: 'Page {{page}} of {{total}}', page, total }));
  } catch {
    // An unlocalized caption still tells the author which sheet they are reading.
  }
  return Array.from({ length: pageCount }, (_, index) => translate(index + 1, pageCount));
};

/** The paginated preview for an AST that prints as a `document`. */
export const paginateDocumentPreviewHtml = async (
  html: string,
  ast: Parameters<typeof resolveDocumentPrintGeometryFromAst>[0],
  options: Omit<PaginatePreviewOptions, 'geometry'> = {},
): Promise<PaginatedPreview> =>
  paginateTemplatePreviewHtml(html, { ...options, geometry: resolveDocumentPrintGeometryFromAst(ast) });
