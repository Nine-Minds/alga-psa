import { StorageService } from '../lib/storage/StorageService';
import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';
import { FileStore } from '../types/storage';
import { getInvoiceForRendering } from '../lib/actions/invoiceQueries';
// Import the action to get template source
import { getInvoiceTemplates, getTemplateSourceAndExecutor } from '../lib/actions/invoiceTemplates';
// Removed: import { renderTemplateCore } from '../components/billing-dashboard/TemplateRendererCore';
// Removed: import React from 'react';
import { runWithTenant, createTenantKnex } from '../lib/db';
// Import both executors
// import { executeWasmTemplate } from '../lib/invoice-renderer/wasm-executor'; // Removed Wasm executor import
import { executeJsTemplate } from '../lib/invoice-renderer/quickjs-executor';
import { renderLayout } from '../lib/invoice-renderer/layout-renderer';
// Keep InvoiceViewModel alias (previously WasmInvoiceViewModel), assuming TS templates use a similar structure
import type { InvoiceViewModel as WasmInvoiceViewModel, LayoutElement } from '../lib/invoice-renderer/types';
import type { InvoiceViewModel as DbInvoiceViewModel, IInvoiceItem } from '../interfaces/invoice.interfaces'; // Alias for clarity
import { DateValue } from '@shared/types/temporal'; // Import DateValue if needed for conversion

interface PDFGenerationOptions {
  invoiceId: string;
  invoiceNumber?: string;
  version?: number;
  cacheKey?: string;
}

export class PDFGenerationService {
  private readonly pdfCacheDir: string;
  private readonly tenant: string;

  constructor(
    private readonly storageService: StorageService,
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

  async generateAndStore(options: PDFGenerationOptions): Promise<FileStore> {
    // Generate HTML content from template
    const htmlContent = await this.getInvoiceHtml(options.invoiceId);
    
    // Generate PDF buffer
    const pdfBuffer = await this.generatePDFBuffer(htmlContent);
    if (!options.invoiceNumber) {
      throw new Error('Invoice number is required');
    }
    
    // Store PDF
    const fileRecord = await StorageService.storePDF(
      options.invoiceId, // Database ID
      options.invoiceNumber, // Filename number (fallback to ID)
      Buffer.from(pdfBuffer),
      {
        version: options.version || 1,
        cacheKey: options.cacheKey,
        generatedAt: new Date().toISOString()
      }
    );

    return fileRecord;
  }

  // Helper function to convert DateValue (Date or ISO string) to ISO string
  private formatDateValue(date: DateValue | undefined): string {
    if (!date) return '';
    if (date instanceof Date) {
      return date.toISOString();
    }
    // Assume it's already an ISO string if not a Date object
    return String(date);
  }


  // Helper function to map DB Invoice data to the Template Renderer's ViewModel
  private mapInvoiceDataToViewModel(dbData: DbInvoiceViewModel): WasmInvoiceViewModel {
    return {
      invoiceNumber: dbData.invoice_number,
      issueDate: this.formatDateValue(dbData.invoice_date),
      dueDate: this.formatDateValue(dbData.due_date),
      customer: {
        name: dbData.company?.name || 'N/A', // Combine company/contact info
        address: dbData.contact?.address || dbData.company?.address || 'N/A', // Use contact address first, fallback to company
      },
      // Map directly since InvoiceViewModel now expects IInvoiceItem[]
      items: dbData.invoice_items,
      subtotal: dbData.subtotal,
      tax: dbData.tax,
      total: dbData.total_amount, // Map total_amount to total
      // notes: dbData.notes, // Add if notes exist in DbInvoiceViewModel
      // timeEntries: dbData.timeEntries, // Add if time entries exist
    };
  }


  private async getInvoiceHtml(invoiceId: string): Promise<string> {
    // Run all database operations with tenant context
    return runWithTenant(this.tenant, async () => {
      // Fetch invoice data and company's template
    const [dbInvoiceData, templates] = await Promise.all([ // Renamed to dbInvoiceData
      getInvoiceForRendering(invoiceId),
      getInvoiceTemplates()
    ]);

    if (!dbInvoiceData) { // Use renamed variable
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    // Get company's selected template or default template
    const { knex } = await createTenantKnex();
    const company = await knex('companies')
      .where({ company_id: dbInvoiceData.company_id }) // Use renamed variable
      .first();

    let template;
    if (company?.invoice_template_id) {
      template = templates.find(t => t.template_id === company.invoice_template_id);
    }
    
    if (!template) {
      // Fall back to default template
      template = templates.find(t => t.is_default);
    }

    if (!template && templates.length > 0) {
      // Fall back to first template if no default set
      template = templates[0];
    }

    if (!template) {
      throw new Error('No invoice templates found');
    }

      // Fetch the template source/binary and determine the executor type
      if (!template.template_id) {
        throw new Error('Selected template does not have an ID.');
      }
      console.log(`[PDF Service] Fetching source/binary for template: ${template.template_id}`);
      const sourceInfo = await getTemplateSourceAndExecutor(template.template_id);

      // Map the fetched DB data to the ViewModel expected by the JS executor
      const invoiceViewModel = this.mapInvoiceDataToViewModel(dbInvoiceData);

      let layoutElement: LayoutElement;

      // Execute with the appropriate engine based on the source type
      switch (sourceInfo.type) {
          case 'js':
              console.log(`[PDF Service] Executing JS template: ${template.template_id}`);
              layoutElement = await executeJsTemplate(sourceInfo.source, invoiceViewModel);
              break;
          // case 'wasm': // Removed Wasm execution path
          //     console.log(`[PDF Service] Executing Wasm template: ${template.template_id}`);
          //     layoutElement = await executeWasmTemplate(sourceInfo.binary, invoiceViewModel);
          //     break;
          case 'not-found':
              throw new Error(`Template with ID ${template.template_id} could not be found for execution.`);
          default:
              throw new Error(`Unknown template source type for ID ${template.template_id}`);
      }

      // Render the layout structure to HTML and CSS
      console.log(`[PDF Service] Rendering layout for template: ${template.template_id}`);
      const renderedOutput = renderLayout(layoutElement);

      // Return the full HTML document string for PDF generation
      return `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Invoice</title> {/* Title might be useful for PDF metadata */}
            <style>
              /* Inject the generated CSS */
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

  private async generatePDFBuffer(content: string): Promise<Uint8Array> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      await page.setContent(content, {
        waitUntil: 'networkidle0'
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '20mm',
          bottom: '20mm',
          left: '20mm'
        }
      });

      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }
}
