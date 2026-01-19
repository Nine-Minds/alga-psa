import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer';

import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import type { FileStore } from '@alga-psa/documents/types/storage';
import { StorageProviderFactory, generateStoragePath } from '@alga-psa/documents/storage/StorageProviderFactory';
import { FileStoreModel } from '@alga-psa/documents/models/storage';

import { getInvoiceForRendering } from '../actions/invoiceQueries';
import { getInvoiceTemplates, renderTemplateOnServer } from '../actions/invoiceTemplates';
import { mapDbInvoiceToWasmViewModel } from '../lib/adapters/invoiceAdapters';
import { browserPoolService } from './browserPoolService';

interface PDFGenerationOptions {
  invoiceId?: string;
  documentId?: string;
  invoiceNumber?: string;
  version?: number;
  cacheKey?: string;
  userId: string;
}

export class PDFGenerationService {
  constructor(private readonly tenant: string) {
    if (!tenant) {
      throw new Error('Tenant is required for PDF generation');
    }
  }

  async generatePDF(options: { invoiceId?: string; documentId?: string; userId: string }): Promise<Buffer> {
    if (!options.invoiceId) {
      throw new Error('Only invoiceId is supported by @alga-psa/billing PDFGenerationService');
    }

    const htmlContent = await this.getInvoiceHtml(options.invoiceId);
    return this.generatePDFBuffer(htmlContent);
  }

  async generateAndStore(options: PDFGenerationOptions): Promise<FileStore> {
    if (!options.invoiceId) {
      throw new Error('Only invoiceId is supported by @alga-psa/billing PDFGenerationService');
    }
    if (!options.invoiceNumber) {
      // Preserve the prior behavior: the caller should supply invoiceNumber for stable filenames.
      // We can fall back to the invoice id, but that makes UX worse.
      options.invoiceNumber = options.invoiceId;
    }

    const pdfBuffer = await this.generatePDF({ invoiceId: options.invoiceId, userId: options.userId });

    return runWithTenant(this.tenant, async () => {
      const fileId = uuidv4();
      const storagePath = generateStoragePath(this.tenant, 'pdfs', `${options.invoiceNumber}.pdf`);

      const provider = await StorageProviderFactory.createProvider();
      const uploadResult = await provider.upload(Buffer.from(pdfBuffer), storagePath, {
        mime_type: 'application/pdf',
      });

      const { knex } = await createTenantKnex();
      const fileRecord = await FileStoreModel.create(knex, {
        fileId,
        file_name: storagePath.split('/').pop()!,
        original_name: `${options.invoiceNumber}.pdf`,
        mime_type: 'application/pdf',
        file_size: pdfBuffer.length,
        storage_path: uploadResult.path,
        uploaded_by_id: options.userId,
      });

      return fileRecord;
    });
  }

  private async getInvoiceHtml(invoiceId: string): Promise<string> {
    return runWithTenant(this.tenant, async () => {
      const [dbInvoiceData, templates] = await Promise.all([getInvoiceForRendering(invoiceId), getInvoiceTemplates()]);

      if (!dbInvoiceData) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      let templateId: string | null = null;

      // Prefer tenant/client-selected template if present.
      // `getInvoiceForRendering` includes `client_id`, but does not currently include `invoice_template_id`.
      // We mimic server behavior: look up client invoice_template_id when needed.
      try {
        const { knex } = await createTenantKnex();
        const client = await knex('clients').where({ client_id: dbInvoiceData.client_id }).first();
        if (client?.invoice_template_id) {
          templateId = client.invoice_template_id;
        }
      } catch {
        // ignore and fall back to default template selection
      }

      if (!templateId) {
        const defaultTemplate = templates.find((t: any) => t.is_default) ?? templates[0];
        templateId = defaultTemplate?.template_id ?? null;
      }

      if (!templateId) {
        throw new Error('No invoice templates available for PDF generation');
      }

      const invoiceViewModel = mapDbInvoiceToWasmViewModel(dbInvoiceData);
      const rendered = await renderTemplateOnServer(templateId, invoiceViewModel);

      // Render into a standalone HTML document for puppeteer.
      return `<!doctype html><html><head><meta charset=\"utf-8\" /><style>${rendered.css}</style></head><body>${rendered.html}</body></html>`;
    });
  }

  private async generatePDFBuffer(htmlContent: string): Promise<Buffer> {
    // Prefer the pool (mirrors server implementation), but fall back to direct launch if needed.
    let browser = await browserPoolService.getBrowser();
    let page: puppeteer.Page | null = null;

    try {
      page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
      });
      return Buffer.from(pdfBuffer);
    } finally {
      if (page) {
        await page.close().catch(() => undefined);
      }
      await browserPoolService.releaseBrowser(browser).catch(() => undefined);
    }
  }
}

export function createPDFGenerationService(tenant: string): PDFGenerationService {
  return new PDFGenerationService(tenant);
}

