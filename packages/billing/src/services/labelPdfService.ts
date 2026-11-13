import type { BrowserContext, Page } from 'puppeteer';
import { configureIsolatedPage, prepareHtmlForIsolatedRendering } from '@alga-psa/core/rendering/isolatedRendering';
import logger from '@alga-psa/core/logger';
import { PDFDocument } from 'pdf-lib';
import { createTenantKnex } from '@alga-psa/db';
import type { InvoicePdfPrintOptions } from '@alga-psa/types';

import { StorageService } from '@alga-psa/storage/StorageService';

import { fetchTenantParty } from '../lib/adapters/tenantPartyAdapter';
import { labelTextOverflowError, renderLabelBatchHtml, type LabelPrintItem } from '../lib/label-batch/renderLabelBatchHtml';
import {
  LabelLayoutError,
  labelMetadataPrefersPaperPage,
  resolveTemplateDeclaredPageSizeMm,
  type LabelBatchLayout,
} from '../lib/label-batch/layout';
import { listDocumentTemplates } from '../lib/document-templates/storage';
import { labelClassOfCustomTemplate } from '../lib/label-template-ast/labelTemplates';
import {
  LABEL_CLASS_BY_STANDARD_CODE,
  LABEL_STANDARD_CODE_BY_CLASS,
  resolveLabelTemplateAst,
} from '../lib/label-template-ast/standardTemplates';
import { inlineLogoDataUrl } from '../lib/label-batch/labelLogo';
import { inlineWorksheetDescriptionImages, type MissingImageText } from '../lib/label-batch/inlineWorksheetImages';
import { resolveDocumentImageDataUrl } from '../lib/invoice-template-ast/server-render';
import { resolveLabelTemplate, type ResolvedLabelTemplate } from '../lib/label-batch/resolveLabelTemplate';
import type { LabelClass } from '@alga-psa/types';
import { browserPoolService } from './browserPoolService';

/** Print an already composed HTML document with explicit print options. */
export async function renderHtmlToPdf(html: string, printOptions: InvoicePdfPrintOptions): Promise<Buffer> {
  const isolatedHtml = await prepareHtmlForIsolatedRendering(html);
  const browser = await browserPoolService.getBrowser();
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  try {
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await configureIsolatedPage(page);
    await page.setContent(isolatedHtml, { waitUntil: 'load' });
    await page.emulateMediaType('print');
    const clippedWorksheets = await page.evaluate(async () => {
      await document.fonts.ready;
      const clipped: number[] = [];
      const tolerance = 0.75;
      for (const cell of document.querySelectorAll<HTMLElement>('.label-cell[data-validate-text-fits="true"]')) {
        // A flow cell (a worksheet page) is bounded horizontally only: content taller than one page
        // continues on the next page, so vertical overflow past the cell is legitimate. Boxes inside
        // the content that clip on their own (an author's fixed-size field) are still checked fully.
        const isFlowCell = cell.dataset.flow === 'true';
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        let isClipped = false;
        for (let node = walker.nextNode(); node && !isClipped; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
          for (let element = node.parentElement; element && cell.contains(element); element = element.parentElement) {
            const style = getComputedStyle(element);
            const clipsOwnBox = ['hidden', 'clip', 'auto', 'scroll'];
            const clipX = element === cell || clipsOwnBox.includes(style.overflowX);
            const clipY = clipsOwnBox.includes(style.overflowY) || (element === cell && !isFlowCell);
            if (!clipX && !clipY) continue;
            const box = element.getBoundingClientRect();
            const left = box.left + element.clientLeft;
            const top = box.top + element.clientTop;
            const right = left + element.clientWidth;
            const bottom = top + element.clientHeight;
            if (rects.some((rect) =>
              (clipX && (rect.left < left - tolerance || rect.right > right + tolerance)) ||
              (clipY && (rect.top < top - tolerance || rect.bottom > bottom + tolerance))
            )) {
              isClipped = true;
              break;
            }
          }
        }
        if (isClipped) clipped.push(Number(cell.dataset.labelIndex) + 1);
      }
      return clipped;
    });
    if (clippedWorksheets.length > 0) {
      throw new LabelLayoutError(
        `Worksheet ${clippedWorksheets.join(', ')} contains text that does not fit. ` +
        'Adjust the layout or shorten the content before printing.',
        { errorCode: 'worksheetTextOverflow', labelIndexes: clippedWorksheets.map((n) => n - 1) },
      );
    }
    return Buffer.from(await page.pdf(printOptions));
  } finally {
    if (page) {
      await page.close().catch((error) => {
        logger.warn('[LabelPdfService] Failed to close rendering page', { error });
      });
    }
    if (context) {
      await context.close().catch((error) => {
        logger.warn('[LabelPdfService] Failed to close isolated rendering context', { error });
      });
    }
    await browserPoolService.releaseBrowser(browser).catch((error) => {
      logger.warn('[LabelPdfService] Failed to release rendering browser', { error });
    });
  }
}

/**
 * Render a batch of labels to ONE PDF (one label per page, or n-up on a sheet), preserving the
 * order of `items`. Read-only: it reads the issuing company's name/logo and writes nothing.
 * Authorization is NOT done here: callers pass view models their providers already authorized.
 */
export async function renderLabelBatchPdf(
  tenant: string,
  items: readonly LabelPrintItem[],
  layout: LabelBatchLayout,
  options: {
    locale?: string;
    /** Printed where a description image could not be included (see inlineWorksheetDescriptionImages). */
    missingImageText: MissingImageText;
    /** Printed where a rich-text description block cannot be rendered. */
    unsupportedContentText: string;
    /**
     * The application's base URL: absolute document image URLs on this origin are read from storage;
     * on any other origin they are remote images.
     */
    baseUrl?: string | null;
  }
): Promise<{ pdf: Buffer; sheets: number; labels: number; missingImages: number; unavailableImages: number }> {
  const { knex } = await createTenantKnex();
  const party = await fetchTenantParty(knex, tenant);
  // The logo is inlined as a data: URL because Puppeteer has no session; an unreadable logo is omitted.
  const logoUrl = party
    ? await inlineLogoDataUrl(party.logo_url, async (fileId) => (await StorageService.downloadFile(fileId)).buffer)
    : null;
  const tenantClient = party ? { name: party.name ?? null, logoUrl } : null;

  // Description images are read for THIS tenant only: a description can come from the client portal
  // or an inbound email, so a document URL naming another tenant's file must not resolve.
  // A storage failure throws out of the resolver and is counted apart from a missing file.
  const { items: printItems, missingImages, unavailableImages } = await inlineWorksheetDescriptionImages(
    items,
    (url) => resolveDocumentImageDataUrl(url, { knex, tenant }),
    options.missingImageText,
    { baseUrl: options.baseUrl, logContext: { tenant, itemCount: items.length } }
  );

  const unsupportedBlockTypes = new Set<string>();
  const { html, geometry, printOptions } = await renderLabelBatchHtml(printItems, layout, {
    tenantClient,
    locale: options.locale,
    richText: {
      unsupportedContentPlaceholder: options.unsupportedContentText,
      missingImagePlaceholder: options.missingImageText(null),
      onUnsupportedContent: (blockType) => unsupportedBlockTypes.add(blockType),
    },
  });
  if (unsupportedBlockTypes.size > 0) {
    logger.warn('[LabelPdfService] Rich-text description blocks printed as a placeholder', {
      tenant,
      itemCount: items.length,
      blockTypes: Array.from(unsupportedBlockTypes),
    });
  }
  let pdf: Buffer;
  try {
    pdf = await renderHtmlToPdf(html, printOptions);
  } catch (error) {
    if (error instanceof LabelLayoutError && error.errorCode === 'worksheetTextOverflow' && error.labelIndexes?.length) {
      throw labelTextOverflowError(items, error.labelIndexes);
    }
    throw error;
  }
  // A worksheet flows across pages, so the planned sheet count is a floor: report the real page
  // count of the produced PDF, falling back to the plan when the buffer cannot be re-read.
  let sheets = geometry.sheets;
  try {
    sheets = (await PDFDocument.load(pdf)).getPageCount();
  } catch (error) {
    // The plan stays the answer for a buffer pdf-lib cannot parse — but that is unexpected, so say so.
    logger.warn('[LabelPdfService] Could not re-read the produced PDF; reporting the planned sheet count', {
      tenant,
      itemCount: items.length,
      plannedSheets: geometry.sheets,
      error,
    });
  }
  return { pdf, sheets, labels: items.length, missingImages, unavailableImages };
}

/** Resolve the template for a print (explicit id -> class default -> standard). Read-only. */
export async function resolveLabelTemplateForTenant(
  tenant: string,
  labelClass: LabelClass,
  templateId?: string | null
): Promise<ResolvedLabelTemplate> {
  const { knex } = await createTenantKnex();
  return resolveLabelTemplate(knex, tenant, labelClass, templateId);
}

/** The layout helper's mm pair in the flatter shape the print dialog consumes. */
const toDialogPaperSize = (size: { widthMm: number; heightMm: number } | null): { width: number; height: number } | null =>
  size ? { width: size.widthMm, height: size.heightMm } : null;

/** The templates a tenant can print a label class with, for the print dialog. Read-only. */
export async function listLabelTemplatesForTenant(
  tenant: string,
  labelClass: LabelClass
): Promise<{
  defaultTemplateId: string;
  templates: Array<{
    id: string;
    name: string;
    source: 'standard' | 'custom';
    prefersPaperPage: boolean;
    /** The page the template declares in mm, when it declares one. */
    paperSizeMm?: { width: number; height: number } | null;
  }>;
}> {
  const { knex } = await createTenantKnex();
  const items = await listDocumentTemplates(knex, tenant, 'work-tag');
  const templates = items
    .filter((item) =>
      item.source === 'standard'
        ? LABEL_CLASS_BY_STANDARD_CODE[item.template_id] === labelClass
        : labelClassOfCustomTemplate(item.templateAst) === labelClass
    )
    .map((item) => {
      // Standard ASTs carry the page size, so the catalog answers for both sources.
      const metadata = resolveLabelTemplateAst({ templateAst: item.templateAst, templateCode: item.template_id })?.metadata;
      return {
        id: item.template_id,
        name: item.name,
        source: item.source,
        // True when the template asks for a full sheet (an A4 or Letter worksheet): the dialog offers
        // "template paper" as the layout default for it.
        prefersPaperPage: labelMetadataPrefersPaperPage(metadata),
        paperSizeMm: toDialogPaperSize(resolveTemplateDeclaredPageSizeMm(metadata)),
      };
    });
  const resolved = await resolveLabelTemplate(knex, tenant, labelClass);
  return { defaultTemplateId: resolved.ok ? resolved.templateCode : LABEL_STANDARD_CODE_BY_CLASS[labelClass], templates };
}
