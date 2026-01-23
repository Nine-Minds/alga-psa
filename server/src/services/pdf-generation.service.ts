import { StorageService } from 'server/src/lib/storage/StorageService';
import { Browser } from 'puppeteer';
import { FileStore } from 'server/src/types/storage';
import { getInvoiceForRendering } from '@alga-psa/billing/actions/invoiceQueries';
import { getInvoiceTemplates, getCompiledWasm } from '@alga-psa/billing/actions/invoiceTemplates';
import { runWithTenant, createTenantKnex } from 'server/src/lib/db';
import { getClientLogoUrl } from 'server/src/lib/utils/avatarUtils';
import { executeWasmTemplate } from 'server/src/lib/invoice-renderer/wasm-executor';
import { renderLayout } from 'server/src/lib/invoice-renderer/layout-renderer';
import type { WasmInvoiceViewModel } from 'server/src/lib/invoice-renderer/types';
import type { InvoiceViewModel as DbInvoiceViewModel, IInvoiceCharge } from 'server/src/interfaces/invoice.interfaces';
import { DateValue } from '@alga-psa/types';
import { browserPoolService, BrowserPoolService } from './browser-pool.service';
import { IDocument } from 'server/src/interfaces/document.interface';
import { getDocument } from '@alga-psa/documents/actions/documentActions';
import { convertBlockNoteToHTML } from 'server/src/lib/utils/blocknoteUtils';
import { v4 as uuidv4 } from 'uuid';
import { StorageProviderFactory, generateStoragePath } from 'server/src/lib/storage/StorageProviderFactory';
import { FileStoreModel } from 'server/src/models/storage';

interface PDFGenerationOptions {
  invoiceId?: string;
  documentId?: string;
  invoiceNumber?: string;
  version?: number;
  cacheKey?: string;
  userId: string;
}

export class PDFGenerationService {
  private readonly pdfCacheDir: string;
  private readonly tenant: string;

  constructor(
    private readonly storageService: StorageService,
    private readonly browserPool: BrowserPoolService,
    private config: {
      pdfCacheDir?: string;
      tenant: string;
    }
  ) {
    if (!config.tenant) {
      throw new Error('Tenant is required for PDF generation');
    }
    this.pdfCacheDir = config.pdfCacheDir || '/tmp/pdf-cache';
    this.tenant = config.tenant;
  }

  async generatePDF(options: { invoiceId?: string; documentId?: string; userId: string }): Promise<Buffer> {
    let htmlContent: string;

    if (options.invoiceId) {
      htmlContent = await this.getInvoiceHtml(options.invoiceId);
    } else if (options.documentId) {
      htmlContent = await this.getDocumentHtml(options.documentId);
    } else {
      throw new Error('Either invoiceId or documentId must be provided');
    }

    const pdfBuffer = await this.generatePDFBuffer(htmlContent);
    return Buffer.from(pdfBuffer);
  }

  async generateAndStore(options: PDFGenerationOptions): Promise<FileStore> {
    let htmlContent: string;
    let entityId: string;
    let fileName: string;

    if (options.invoiceId) {
      htmlContent = await this.getInvoiceHtml(options.invoiceId);
      entityId = options.invoiceId;
      if (!options.invoiceNumber) {
        throw new Error('Invoice number is required for invoice PDF generation');
      }
      fileName = options.invoiceNumber;
    } else if (options.documentId) {
      htmlContent = await this.getDocumentHtml(options.documentId);
      entityId = options.documentId;

      const document = await runWithTenant(this.tenant, () => getDocument(options.documentId!));
      if (!document) {
        throw new Error(`Document ${options.documentId} not found.`);
      }
      fileName = document.document_name || options.documentId;
    } else {
      throw new Error('Either invoiceId or documentId must be provided');
    }

    const pdfBuffer = await this.generatePDFBuffer(htmlContent);

    // Use the static method to store the PDF
    const fileId = uuidv4();
    const storagePath = generateStoragePath(this.tenant, 'pdfs', `${fileName}.pdf`);
    
    // Get storage provider
    const provider = await StorageProviderFactory.createProvider();
    
    // Upload the PDF
    const uploadResult = await provider.upload(Buffer.from(pdfBuffer), storagePath, {
      mime_type: 'application/pdf',
    });
    
    const { knex } = await createTenantKnex();
    const fileRecord = await FileStoreModel.create(knex, {
      file_name: storagePath.split('/').pop()!,
      original_name: `${fileName}.pdf`,
      mime_type: 'application/pdf',
      file_size: pdfBuffer.length,
      storage_path: uploadResult.path,
      uploaded_by_id: options.userId,
      fileId: fileId // Add fileId since FileStore type expects it
    });
    
    // Update metadata separately if needed
    // TODO: Re-enable when metadata column is added to external_files table
    // await FileStoreModel.updateMetadata(knex, fileRecord.file_id, {
    //   version: options.version || 1,
    //   cacheKey: options.cacheKey,
    //   generatedAt: new Date().toISOString(),
    //   entityId,
    //   tenant: this.tenant
    // });

    return fileRecord;
  }

  private formatDateValue(date: DateValue | undefined): string {
    if (!date) return '';
    if (date instanceof Date) {
      return date.toISOString();
    }
    return String(date);
  }

  private async mapInvoiceDataToViewModel(dbData: DbInvoiceViewModel): Promise<WasmInvoiceViewModel> {
    let tenantClientInfo: { name: any; address: any; logoUrl: string | null } | null = null;
    const { knex } = await createTenantKnex();
    const tenantClientLink = await knex('tenant_companies')
      .where({ tenant: this.tenant, is_default: true })
      .select('client_id')
      .first();

    if (tenantClientLink) {
      const tenantClientDetails = await knex('clients as c')
        .leftJoin('client_locations as cl', function() {
          this.on('c.client_id', '=', 'cl.client_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', knex.raw('true'));
        })
        .where({ 'c.client_id': tenantClientLink.client_id })
        .select(
          'c.client_name',
          knex.raw(`COALESCE(
            CONCAT_WS(', ', 
              cl.address_line1, 
              cl.address_line2, 
              cl.city, 
              cl.state_province, 
              cl.postal_code, 
              cl.country_name
            ), ''
          ) as address`)
        )
        .first();

      if (tenantClientDetails) {
        const logoUrl = await getClientLogoUrl(tenantClientLink.client_id, this.tenant);
        tenantClientInfo = {
          name: tenantClientDetails.client_name,
          address: tenantClientDetails.address,
          logoUrl: logoUrl || null,
        };
      }
    }

    return {
      invoiceNumber: dbData.invoice_number,
      issueDate: this.formatDateValue(dbData.invoice_date),
      dueDate: this.formatDateValue(dbData.due_date),
      poNumber: dbData.po_number ?? null,
      customer: {
        name: dbData.client?.name || 'N/A',
        address: dbData.contact?.address || dbData.client?.address || 'N/A',
      },
      items: dbData.invoice_charges.map((item: IInvoiceCharge) => ({
        id: item.item_id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        total: item.total_price,
      })),
      subtotal: dbData.subtotal,
      tax: dbData.tax,
      total: dbData.total_amount,
      currencyCode: (dbData as any).currency_code || (dbData as any).currencyCode || 'USD',
      tenantClient: tenantClientInfo,
    };
  }

  private async getInvoiceHtml(invoiceId: string): Promise<string> {
    return runWithTenant(this.tenant, async () => {
      const [dbInvoiceData, templates] = await Promise.all([
        getInvoiceForRendering(invoiceId),
        getInvoiceTemplates()
      ]);

      if (!dbInvoiceData) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      const { knex } = await createTenantKnex();
      const client = await knex('clients')
        .where({ client_id: dbInvoiceData.client_id })
        .first();

      let template;
      if (client?.invoice_template_id) {
        template = templates.find(t => t.template_id === client.invoice_template_id);
      }
      if (!template) {
        template = templates.find(t => t.isTenantDefault);
      }
      if (!template && templates.length > 0) {
        template = templates[0];
      }
      if (!template) {
        throw new Error('No invoice templates found');
      }
      if (!template.template_id) {
        throw new Error('Selected template does not have an ID.');
      }
      const wasmBuffer = await getCompiledWasm(template.template_id);
      const wasmInvoiceViewModel = await this.mapInvoiceDataToViewModel(dbInvoiceData);
      const layoutElement = await executeWasmTemplate(wasmInvoiceViewModel, wasmBuffer);
      const renderedOutput = renderLayout(layoutElement);

      return `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Invoice</title>
            <style>
              ${renderedOutput.css}
            </style>
          </head>
          <body>
            ${renderedOutput.html}
          </body>
        </html>
      `;
    });
  }

  private async getDocumentHtml(documentId: string): Promise<string> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();
      const document = await getDocument(documentId);
      
      if (!document) {
        throw new Error(`Document ${documentId} not found`);
      }

      let htmlContent = '';

      // Check for BlockNote content
      const blockContent = await knex('document_block_content')
        .where({ document_id: documentId, tenant: this.tenant })
        .first();
        
      if (blockContent && blockContent.block_data) {
        htmlContent = convertBlockNoteToHTML(blockContent.block_data);
      } else {
        // Check for regular text content
        const textContent = await knex('document_content')
          .where({ document_id: documentId, tenant: this.tenant })
          .first();
          
        if (textContent && textContent.content) {
          if (document.mime_type === 'text/markdown') {
            const marked = (await import('marked')).marked;
            htmlContent = await marked(textContent.content);
          } else {
            // Plain text
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

      return `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${document.document_name || 'Document'}</title>
            <style>
              body { font-family: sans-serif; margin: 0; padding: 5mm; }
              pre { white-space: pre-wrap; word-wrap: break-word; }
              h1, h2, h3, h4, h5, h6 { margin-top: 1em; margin-bottom: 0.5em; }
              p { margin-top: 0; margin-bottom: 1em; }
              table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              ul, ol { padding-left: 20px; margin-top: 0; margin-bottom: 1em; }
              img { max-width: 100%; height: auto; }
            </style>
          </head>
          <body>
            ${htmlContent}
          </body>
        </html>
      `;
    });
  }

  private async generatePDFBuffer(content: string): Promise<Uint8Array> {
    let browser: Browser | null = null;
    try {
      browser = await this.browserPool.getBrowser();
      const page = await browser.newPage();
      await page.setContent(content, {
        waitUntil: 'networkidle0'
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm'
        }
      });
      await page.close();
      return pdfBuffer;
    } finally {
      if (browser) {
        await this.browserPool.releaseBrowser(browser);
      }
    }
  }
}

// Factory function to create a PDF generation service with the specified tenant
export const createPDFGenerationService = (tenant: string) => {
  // Create a new instance with the StorageService singleton
  return new PDFGenerationService(
    StorageService as any,
    browserPoolService,
    { tenant }
  );
};
