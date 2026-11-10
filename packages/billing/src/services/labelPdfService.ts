import type { BrowserContext, Page } from 'puppeteer';
import { configureIsolatedPage, prepareHtmlForIsolatedRendering } from '@alga-psa/core/rendering/isolatedRendering';
import logger from '@alga-psa/core/logger';
import { PDFDocument } from 'pdf-lib';
import { createTenantKnex } from '@alga-psa/db';
import type { InvoicePdfPrintOptions } from '@alga-psa/types';

import { StorageService } from '@alga-psa/storage/StorageService';

import { fetchTenantParty } from '../lib/adapters/tenantPartyAdapter';
import { renderLabelBatchHtml, type LabelPrintItem } from '../lib/label-batch/renderLabelBatchHtml';
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
  getStandardLabelTemplateAstByCode,
} from '../lib/label-template-ast/standardTemplates';
import { inlineLogoDataUrl } from '../lib/label-batch/labelLogo';
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
        { errorCode: 'worksheetTextOverflow', worksheetNumbers: clippedWorksheets },
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
  options: { locale?: string } = {}
): Promise<{ pdf: Buffer; sheets: number; labels: number }> {
  const { knex } = await createTenantKnex();
  const party = await fetchTenantParty(knex, tenant);
  // The logo is inlined as a data: URL because Puppeteer has no session; an unreadable logo is omitted.
  const logoUrl = party
    ? await inlineLogoDataUrl(party.logo_url, async (fileId) => (await StorageService.downloadFile(fileId)).buffer)
    : null;
  const tenantClient = party ? { name: party.name ?? null, logoUrl } : null;

  const { html, geometry, printOptions } = await renderLabelBatchHtml(items, layout, {
    tenantClient,
    locale: options.locale,
  });
  const pdf = await renderHtmlToPdf(html, printOptions);
  // A worksheet flows across pages, so the planned sheet count is a floor: report the real page
  // count of the produced PDF, falling back to the plan when the buffer cannot be re-read.
  let sheets = geometry.sheets;
  try {
    sheets = (await PDFDocument.load(pdf)).getPageCount();
  } catch {
    // The plan stays the answer for a buffer pdf-lib cannot parse.
  }
  return { pdf, sheets, labels: items.length };
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
    .map((item) => ({
      id: item.template_id,
      name: item.name,
      source: item.source,
      // True when the template asks for a full sheet (an A4 or Letter worksheet): the dialog offers
      // "template paper" as the layout default for it. Standard ASTs carry the page size, so the
      // catalog answers for both sources.
      prefersPaperPage:
        labelMetadataPrefersPaperPage(item.templateAst?.metadata) ||
        (item.source === 'standard'
          ? labelMetadataPrefersPaperPage(getStandardLabelTemplateAstByCode(item.template_id)?.metadata)
          : false),
      paperSizeMm: toDialogPaperSize(resolveTemplateDeclaredPageSizeMm(item.templateAst?.metadata))
        ?? (item.source === 'standard'
          ? toDialogPaperSize(resolveTemplateDeclaredPageSizeMm(getStandardLabelTemplateAstByCode(item.template_id)?.metadata))
          : null),
    }));
  const resolved = await resolveLabelTemplate(knex, tenant, labelClass);
  return { defaultTemplateId: resolved.ok ? resolved.templateCode : LABEL_STANDARD_CODE_BY_CLASS[labelClass], templates };
}
