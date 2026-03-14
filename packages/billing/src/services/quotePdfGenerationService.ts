import { v4 as uuidv4 } from 'uuid';
import type { InvoiceTemplateAst } from '@alga-psa/types';
import type { Page } from 'puppeteer';
import type { FileStore } from '@alga-psa/storage/types/storage';

import { createTenantKnex, runWithTenant } from '@alga-psa/db';

import { getFileStoreModelAsync, getStorageProviderFactoryAsync } from '../lib/documentsHelpers';
import { mapDbQuoteToViewModel } from '../lib/adapters/quoteAdapters';
import { evaluateInvoiceTemplateAst } from '../lib/invoice-template-ast/evaluator';
import { renderEvaluatedInvoiceTemplateAst } from '../lib/invoice-template-ast/react-renderer';
import { getStandardQuoteTemplateAstByCode } from '../lib/quote-template-ast/standardTemplates';
import { resolveQuoteTemplateAst } from '../lib/quote-template-ast/templateSelection';
import Quote from '../models/quote';
import { browserPoolService } from './browserPoolService';

interface QuotePDFGenerationOptions {
  quoteId: string;
  templateCode?: string;
  templateAst?: InvoiceTemplateAst;
}

interface QuoteTemplatePreview {
  html: string;
  css: string;
}

interface QuotePDFStoreOptions extends QuotePDFGenerationOptions {
  quoteNumber?: string;
  userId: string;
}

export class QuotePDFGenerationService {
  constructor(private readonly tenant: string) {
    if (!tenant) {
      throw new Error('Tenant is required for quote PDF generation');
    }
  }

  async generatePDF(options: QuotePDFGenerationOptions): Promise<Buffer> {
    const htmlContent = await this.getQuoteHtml(options);
    return this.generatePDFBuffer(htmlContent);
  }

  async renderPreview(options: QuotePDFGenerationOptions): Promise<QuoteTemplatePreview> {
    return this.renderQuoteTemplate(options);
  }

  async generateAndStore(options: QuotePDFStoreOptions): Promise<FileStore> {
    const pdfBuffer = await this.generatePDF(options);

    return runWithTenant(this.tenant, async () => {
      const fileId = uuidv4();
      const { StorageProviderFactory, generateStoragePath } = await getStorageProviderFactoryAsync();
      const FileStoreModel = await getFileStoreModelAsync();
      const { knex } = await createTenantKnex();

      const quoteRecord = await Quote.getById(knex, this.tenant, options.quoteId);
      const fileStem = options.quoteNumber ?? quoteRecord?.quote_number ?? options.quoteId;
      const storagePath = generateStoragePath(this.tenant, 'pdfs', `${fileStem}.pdf`);

      const provider = await StorageProviderFactory.createProvider();
      const uploadResult = await provider.upload(Buffer.from(pdfBuffer), storagePath, {
        mime_type: 'application/pdf',
      });

      return FileStoreModel.create(knex, {
        fileId,
        file_name: storagePath.split('/').pop()!,
        original_name: `${fileStem}.pdf`,
        mime_type: 'application/pdf',
        file_size: pdfBuffer.length,
        storage_path: uploadResult.path,
        uploaded_by_id: options.userId,
      });
    });
  }

  private async getQuoteHtml(options: QuotePDFGenerationOptions): Promise<string> {
    const rendered = await this.renderQuoteTemplate(options);
    return `<!doctype html><html><head><meta charset=\"utf-8\" /><style>${rendered.css}</style></head><body>${rendered.html}</body></html>`;
  }

  private async renderQuoteTemplate(options: QuotePDFGenerationOptions): Promise<QuoteTemplatePreview> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();
      const quoteViewModel = await mapDbQuoteToViewModel(knex, this.tenant, options.quoteId);

      if (!quoteViewModel) {
        throw new Error(`Quote ${options.quoteId} not found`);
      }

      const templateAst = options.templateAst
        ?? (options.templateCode
          ? getStandardQuoteTemplateAstByCode(options.templateCode)
          : (await resolveQuoteTemplateAst(knex, this.tenant, options.quoteId)).templateAst);

      if (!templateAst) {
        throw new Error('No quote template AST available for PDF generation');
      }

      const evaluation = evaluateInvoiceTemplateAst(
        templateAst,
        quoteViewModel as unknown as Record<string, unknown>
      );
      return renderEvaluatedInvoiceTemplateAst(templateAst, evaluation);
    });
  }

  private async generatePDFBuffer(htmlContent: string): Promise<Buffer> {
    const browser = await browserPoolService.getBrowser();
    let page: Page | null = null;

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

export function createQuotePDFGenerationService(tenant: string): QuotePDFGenerationService {
  return new QuotePDFGenerationService(tenant);
}
