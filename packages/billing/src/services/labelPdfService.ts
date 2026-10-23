import type { Page } from 'puppeteer';
import { createTenantKnex } from '@alga-psa/db';
import type { InvoicePdfPrintOptions } from '@alga-psa/types';

import { fetchTenantParty } from '../lib/adapters/tenantPartyAdapter';
import { renderLabelBatchHtml, type LabelPrintItem } from '../lib/label-batch/renderLabelBatchHtml';
import type { LabelBatchLayout } from '../lib/label-batch/layout';
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
  const tenantClient = party ? { name: party.name ?? null, logoUrl: party.logo_url ?? null } : null;

  const { html, geometry, printOptions } = await renderLabelBatchHtml(items, layout, {
    tenantClient,
    locale: options.locale,
  });
  const pdf = await renderHtmlToPdf(html, printOptions);
  return { pdf, sheets: geometry.sheets, labels: items.length };
}
