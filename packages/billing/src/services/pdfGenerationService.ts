import { v4 as uuidv4 } from 'uuid';
import type { Page } from 'puppeteer';
import type { Knex } from 'knex';

import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import type { TemplateAst } from '@alga-psa/types';
import type { FileStore } from '@alga-psa/storage/types/storage';
import { StorageProviderFactory, generateStoragePath, FileStoreModel } from '@alga-psa/storage';
import { convertBlockContentToHTML } from '@alga-psa/formatting/blocknoteUtils';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildDocumentGeneratedPayload } from '@alga-psa/workflow-streams';

import { getInvoiceForRendering } from '../actions/invoiceQueries';
import { getInvoiceTemplate, getInvoiceTemplates } from '../actions/invoiceTemplates';
import { mapDbInvoiceToWasmViewModel } from '../lib/adapters/invoiceAdapters';
import { mapDbQuoteToViewModel } from '../lib/adapters/quoteAdapters';
import { fetchTenantParty } from '../lib/adapters/tenantPartyAdapter';
import { evaluateTemplateAst } from '../lib/invoice-template-ast/evaluator';
import { resolvePdfPrintOptionsFromAst } from '../lib/invoice-template-ast/printSettings';
import { renderEvaluatedTemplateAst } from '../lib/invoice-template-ast/react-renderer';
import { renderTemplateAstHtmlDocument } from '../lib/invoice-template-ast/server-render';
import { getStandardQuoteTemplateAstByCode } from '../lib/quote-template-ast/standardTemplates';
import { resolveQuoteTemplateAst } from '../lib/quote-template-ast/templateSelection';
import { browserPoolService } from './browserPoolService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PDFGenerationOptions {
  invoiceId?: string;
  quoteId?: string;
  documentId?: string;
  invoiceNumber?: string;
  quoteNumber?: string;
  version?: number;
  cacheKey?: string;
  userId: string;
}

export interface QuotePDFOptions {
  quoteId: string;
  templateCode?: string;
  templateAst?: TemplateAst;
}

const DEFAULT_DOCUMENT_PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  margin: {
    top: '10mm',
    right: '10mm',
    bottom: '10mm',
    left: '10mm',
  },
} as const;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PDFGenerationService {
  constructor(private readonly tenant: string) {
    if (!tenant) {
      throw new Error('Tenant is required for PDF generation');
    }
  }

  // ---- Generic entry points ------------------------------------------------

  async generatePDF(options: { invoiceId?: string; quoteId?: string; documentId?: string; userId: string; templateAst?: TemplateAst; templateId?: string }): Promise<Buffer> {
    let htmlContent: string;
    let templateAst: TemplateAst | null = null;

    if (options.invoiceId) {
      const result = await this.getInvoiceHtml(options.invoiceId, options.templateId);
      htmlContent = result.htmlContent;
      templateAst = result.templateAst;
    } else if (options.quoteId) {
      const result = await this.getQuoteHtml({ quoteId: options.quoteId, templateAst: options.templateAst });
      htmlContent = result.htmlContent;
      templateAst = result.templateAst;
    } else if (options.documentId) {
      htmlContent = await this.getDocumentHtml(options.documentId);
    } else {
      throw new Error('One of invoiceId, quoteId, or documentId must be provided');
    }

    return this.generatePDFBuffer(htmlContent, templateAst);
  }

  async generateAndStore(options: PDFGenerationOptions): Promise<FileStore> {
    let entityId: string;
    let fileName: string;
    let sourceType: string;

    if (options.invoiceId) {
      entityId = options.invoiceId;
      fileName = options.invoiceNumber || options.invoiceId;
      sourceType = 'invoice';
    } else if (options.quoteId) {
      entityId = options.quoteId;
      fileName = options.quoteNumber || options.quoteId;
      sourceType = 'quote';
    } else if (options.documentId) {
      entityId = options.documentId;
      sourceType = 'document';
      const document = await this.getDocumentRecord(options.documentId);
      if (!document) {
        throw new Error(`Document ${options.documentId} not found.`);
      }
      fileName = document.document_name || options.documentId;
    } else {
      throw new Error('One of invoiceId, quoteId, or documentId must be provided');
    }

    const pdfBuffer = await this.generatePDF({
      invoiceId: options.invoiceId,
      quoteId: options.quoteId,
      documentId: options.documentId,
      userId: options.userId,
    });

    return runWithTenant(this.tenant, async () => {
      const fileId = uuidv4();
      const storagePath = generateStoragePath(this.tenant, 'pdfs', `${fileName}.pdf`);

      const provider = await StorageProviderFactory.createProvider();
      const uploadResult = await provider.upload(Buffer.from(pdfBuffer), storagePath, {
        mime_type: 'application/pdf',
      });

      const { knex } = await createTenantKnex();
      const fileRecord = await FileStoreModel.create(knex, {
        fileId,
        file_name: storagePath.split('/').pop()!,
        original_name: `${fileName}.pdf`,
        mime_type: 'application/pdf',
        file_size: pdfBuffer.length,
        storage_path: uploadResult.path,
        uploaded_by_id: options.userId,
      });

      try {
        await publishWorkflowEvent({
          eventType: 'DOCUMENT_GENERATED',
          ctx: {
            tenantId: this.tenant,
            actor: { actorType: 'USER', actorUserId: options.userId },
          },
          payload: buildDocumentGeneratedPayload({
            documentId: fileRecord.file_id,
            sourceType,
            sourceId: entityId,
            generatedByUserId: options.userId,
            generatedAt: new Date().toISOString(),
            fileName: `${fileName}.pdf`,
          }),
        });
      } catch {
        // Non-blocking
      }

      return fileRecord;
    });
  }

  // ---- Preview entry points -------------------------------------------------

  async renderInvoicePreview(options: {
    invoiceId: string;
    templateId?: string;
    templateAst?: TemplateAst;
  }): Promise<{ html: string; css: string; templateAst: TemplateAst | null }> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();

      const dbInvoiceData = await getInvoiceForRendering(options.invoiceId);
      if (!dbInvoiceData) {
        throw new Error(`Invoice ${options.invoiceId} not found`);
      }

      let templateAst: TemplateAst | null = options.templateAst ?? null;

      if (!templateAst) {
        const templateId = options.templateId ?? await this.resolveInvoiceTemplateId(knex, dbInvoiceData);
        if (!templateId) {
          throw new Error('No invoice templates available');
        }
        const templates = await getInvoiceTemplates();
        const selected = templates.find((t: any) => t.template_id === templateId);
        templateAst = (selected?.templateAst ?? null) as TemplateAst | null;
        if (!templateAst) {
          const canonical = await getInvoiceTemplate(templateId);
          templateAst = (canonical?.templateAst ?? null) as TemplateAst | null;
        }
      }

      if (!templateAst) {
        throw new Error('No invoice template AST available');
      }

      const enrichedData = await this.enrichWithTenantClient(knex, dbInvoiceData);
      const invoiceViewModel = mapDbInvoiceToWasmViewModel(enrichedData);
      if (!invoiceViewModel) {
        throw new Error(`Failed to map invoice ${options.invoiceId} to view model`);
      }

      const evaluation = evaluateTemplateAst(
        templateAst,
        invoiceViewModel as unknown as Record<string, unknown>
      );
      const rendered = await renderEvaluatedTemplateAst(templateAst, evaluation);
      return { html: rendered.html, css: rendered.css, templateAst };
    });
  }

  // ---- Quote-specific entry points -----------------------------------------

  async renderQuotePreview(options: QuotePDFOptions): Promise<{ html: string; css: string; templateAst: TemplateAst | null }> {
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
        throw new Error('No quote template AST available');
      }

      const evaluation = evaluateTemplateAst(
        templateAst,
        quoteViewModel as unknown as Record<string, unknown>
      );
      const rendered = await renderEvaluatedTemplateAst(templateAst, evaluation);
      return { html: rendered.html, css: rendered.css, templateAst };
    });
  }

  // ---- Invoice HTML --------------------------------------------------------

  private async resolveInvoiceTemplateId(knex: Knex | Knex.Transaction, dbInvoiceData: any): Promise<string | null> {
    let templateId: string | null = null;

    try {
      const client = await knex('clients')
        .where({ client_id: dbInvoiceData.client_id })
        .first();
      if (client?.invoice_template_id) {
        templateId = client.invoice_template_id;
      }
    } catch {
      // Fall back to default template selection
    }

    if (!templateId) {
      const templates = await getInvoiceTemplates();
      const defaultTemplate = templates.find((t: any) => t.is_default || t.isTenantDefault) ?? templates[0];
      templateId = defaultTemplate?.template_id ?? null;
    }

    return templateId;
  }

  private async getInvoiceHtml(
    invoiceId: string,
    overrideTemplateId?: string
  ): Promise<{ htmlContent: string; templateAst: TemplateAst | null }> {
    return runWithTenant(this.tenant, async () => {
      const [dbInvoiceData, templates] = await Promise.all([
        getInvoiceForRendering(invoiceId),
        getInvoiceTemplates(),
      ]);

      if (!dbInvoiceData) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      const { knex } = await createTenantKnex();

      const templateId = overrideTemplateId || await this.resolveInvoiceTemplateId(knex, dbInvoiceData);

      if (!templateId) {
        throw new Error('No invoice templates available for PDF generation');
      }

      const selectedTemplate = templates.find((entry: any) => entry.template_id === templateId) ?? null;
      let templateAst = (selectedTemplate?.templateAst ?? null) as TemplateAst | null;
      if (!templateAst && templateId) {
        const canonicalTemplate = await getInvoiceTemplate(templateId);
        templateAst = (canonicalTemplate?.templateAst ?? null) as TemplateAst | null;
      }

      if (!templateAst) {
        throw new Error(`Template ${templateId} does not have a templateAst payload.`);
      }

      const enrichedData = await this.enrichWithTenantClient(knex, dbInvoiceData);
      const invoiceViewModel = mapDbInvoiceToWasmViewModel(enrichedData);

      if (!invoiceViewModel) {
        throw new Error(`Failed to map invoice ${invoiceId} to view model`);
      }

      const evaluation = evaluateTemplateAst(
        templateAst,
        invoiceViewModel as unknown as Record<string, unknown>
      );

      const htmlContent = await renderTemplateAstHtmlDocument(templateAst, evaluation, {
        title: 'Invoice',
        knex,
      });

      return { htmlContent, templateAst };
    });
  }

  private async enrichWithTenantClient(
    knex: Knex | Knex.Transaction,
    dbData: any,
  ): Promise<any> {
    try {
      const tenantParty = await fetchTenantParty(knex, this.tenant);
      if (!tenantParty) return dbData;

      return {
        ...dbData,
        tenantClient: {
          name: tenantParty.name,
          address: tenantParty.address,
          logoUrl: tenantParty.logo_url,
        },
      };
    } catch {
      return dbData;
    }
  }

  // ---- Quote HTML ----------------------------------------------------------

  private async getQuoteHtml(
    options: QuotePDFOptions
  ): Promise<{ htmlContent: string; templateAst: TemplateAst | null }> {
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

      const evaluation = evaluateTemplateAst(
        templateAst,
        quoteViewModel as unknown as Record<string, unknown>
      );

      const htmlContent = await renderTemplateAstHtmlDocument(templateAst, evaluation, {
        title: `Quote ${quoteViewModel.quote_number ?? ''}`.trim(),
        knex,
      });

      return { htmlContent, templateAst };
    });
  }

  // ---- Document HTML -------------------------------------------------------

  private async getDocumentHtml(documentId: string): Promise<string> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();
      const document = await this.getDocumentRecord(documentId);

      if (!document) {
        throw new Error(`Document ${documentId} not found`);
      }

      let htmlContent = '';

      const blockContent = await knex('document_block_content')
        .where({ document_id: documentId, tenant: this.tenant })
        .first();

      if (blockContent && blockContent.block_data) {
        htmlContent = convertBlockContentToHTML(blockContent.block_data);
      } else {
        const textContent = await knex('document_content')
          .where({ document_id: documentId, tenant: this.tenant })
          .first();

        if (textContent && textContent.content) {
          if (document.mime_type === 'text/markdown') {
            const { marked } = await import('marked');
            htmlContent = await marked(textContent.content);
          } else {
            const escapedText = textContent.content
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
            htmlContent = `<pre>${escapedText}</pre>`;
          }
        } else {
          throw new Error(`Document ${documentId} has no content`);
        }
      }

      return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${document.document_name || 'Document'}</title>
    <style>
      body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; margin: 0; padding: 5mm; }
      pre { white-space: pre-wrap; word-wrap: break-word; }
      h1, h2, h3, h4, h5, h6 { margin-top: 1em; margin-bottom: 0.5em; }
      p { margin-top: 0; margin-bottom: 1em; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      ul, ol { padding-left: 20px; margin-top: 0; margin-bottom: 1em; }
      blockquote { border-left: 3px solid #ddd; margin: 0 0 1em; padding: 0.5em 1em; color: #555; }
      img { max-width: 100%; height: auto; }
      a { color: #1e40af; text-decoration: underline; }
      code { background-color: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
      pre code { background: none; padding: 0; }
      pre { background-color: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; }
    </style>
  </head>
  <body>
    ${htmlContent}
  </body>
</html>`;
    });
  }

  private async getDocumentRecord(documentId: string): Promise<{ document_id: string; document_name: string; mime_type?: string; tenant: string } | null> {
    const { knex } = await createTenantKnex();
    return knex('documents')
      .where({ document_id: documentId, tenant: this.tenant })
      .select('document_id', 'document_name', 'mime_type', 'tenant')
      .first() ?? null;
  }

  // ---- Puppeteer -----------------------------------------------------------

  private async generatePDFBuffer(htmlContent: string, templateAst?: TemplateAst | null): Promise<Buffer> {
    const browser = await browserPoolService.getBrowser();
    let page: Page | null = null;

    try {
      page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf(
        templateAst ? resolvePdfPrintOptionsFromAst(templateAst) : DEFAULT_DOCUMENT_PDF_OPTIONS
      );
      return Buffer.from(pdfBuffer);
    } finally {
      if (page) {
        await page.close().catch(() => undefined);
      }
      await browserPoolService.releaseBrowser(browser).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPDFGenerationService(tenant: string): PDFGenerationService {
  return new PDFGenerationService(tenant);
}
