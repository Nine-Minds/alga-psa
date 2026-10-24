import type { Page } from 'puppeteer';
import { createTenantKnex } from '@alga-psa/db';
import type { InvoicePdfPrintOptions } from '@alga-psa/types';

import { StorageService } from '@alga-psa/storage/StorageService';

import { fetchTenantParty } from '../lib/adapters/tenantPartyAdapter';
import { renderLabelBatchHtml, type LabelPrintItem } from '../lib/label-batch/renderLabelBatchHtml';
import type { LabelBatchLayout } from '../lib/label-batch/layout';
import { listDocumentTemplates } from '../lib/document-templates/storage';
import { labelClassOfCustomTemplate } from '../lib/label-template-ast/labelTemplates';
import { LABEL_CLASS_BY_STANDARD_CODE, LABEL_STANDARD_CODE_BY_CLASS } from '../lib/label-template-ast/standardTemplates';
import { inlineLogoDataUrl } from '../lib/label-batch/labelLogo';
import { resolveLabelTemplate, type ResolvedLabelTemplate } from '../lib/label-batch/resolveLabelTemplate';
import type { LabelClass } from '@alga-psa/types';
import { browserPoolService } from './browserPoolService';

/** Print an already composed HTML document with explicit print options. */
export async function renderHtmlToPdf(html: string, printOptions: InvoicePdfPrintOptions): Promise<Buffer> {
  const browser = await browserPoolService.getBrowser();
  let page: Page | null = null;
  try {
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return Buffer.from(await page.pdf(printOptions));
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    await browserPoolService.releaseBrowser(browser).catch(() => undefined);
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
  return { pdf, sheets: geometry.sheets, labels: items.length };
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

/** The templates a tenant can print a label class with, for the print dialog. Read-only. */
export async function listLabelTemplatesForTenant(
  tenant: string,
  labelClass: LabelClass
): Promise<{ defaultTemplateId: string; templates: Array<{ id: string; name: string; source: 'standard' | 'custom' }> }> {
  const { knex } = await createTenantKnex();
  const items = await listDocumentTemplates(knex, tenant, 'work-tag');
  const templates = items
    .filter((item) =>
      item.source === 'standard'
        ? LABEL_CLASS_BY_STANDARD_CODE[item.template_id] === labelClass
        : labelClassOfCustomTemplate(item.templateAst) === labelClass
    )
    .map((item) => ({ id: item.template_id, name: item.name, source: item.source }));
  const resolved = await resolveLabelTemplate(knex, tenant, labelClass);
  return { defaultTemplateId: resolved.ok ? resolved.templateCode : LABEL_STANDARD_CODE_BY_CLASS[labelClass], templates };
}
