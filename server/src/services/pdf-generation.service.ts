import { StorageService } from '../lib/storage/StorageService';
import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';
import { FileStore } from '../types/storage';
import { getInvoiceForRendering } from '../lib/actions/invoiceQueries';
import { getInvoiceTemplates, getCompiledWasm } from '../lib/actions/invoiceTemplates';
// Removed: import { renderTemplateCore } from '../components/billing-dashboard/TemplateRendererCore';
// Removed: import React from 'react';
import { runWithTenant, createTenantKnex } from '../lib/db';
// Import getCompanyLogoUrl
import { getCompanyLogoUrl } from '../lib/utils/avatarUtils';
import { executeWasmTemplate } from '../lib/invoice-renderer/wasm-executor';
import { renderLayout } from '../lib/invoice-renderer/layout-renderer';
import type { WasmInvoiceViewModel } from '../lib/invoice-renderer/types'; // Alias for clarity
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


  // Helper function to map DB Invoice data to the Wasm Renderer's ViewModel
  // Make it async to allow fetching tenant company info
  private async mapInvoiceDataToViewModel(dbData: DbInvoiceViewModel): Promise<WasmInvoiceViewModel> {
    // Fetch Tenant Company Info
    let tenantCompanyInfo = null;
    const { knex } = await createTenantKnex(); // Get knex instance
    const tenantCompanyLink = await knex('tenant_companies')
      .where({ tenant_id: this.tenant, is_default: true }) // Use this.tenant
      .select('company_id')
      .first();

    if (tenantCompanyLink) {
      const tenantCompanyDetails = await knex('companies')
        .where({ company_id: tenantCompanyLink.company_id })
        .select('company_name', 'address')
        .first();

      if (tenantCompanyDetails) {
        const logoUrl = await getCompanyLogoUrl(tenantCompanyLink.company_id, this.tenant); // Use this.tenant
        tenantCompanyInfo = {
          name: tenantCompanyDetails.company_name,
          address: tenantCompanyDetails.address,
          logoUrl: logoUrl || null,
        };
      }
    }

    return {
      invoiceNumber: dbData.invoice_number,
      issueDate: this.formatDateValue(dbData.invoice_date),
      dueDate: this.formatDateValue(dbData.due_date),
      customer: {
        name: dbData.company?.name || 'N/A', // Combine company/contact info
        address: dbData.contact?.address || dbData.company?.address || 'N/A', // Use contact address first, fallback to company
      },
      items: dbData.invoice_items.map((item: IInvoiceItem) => ({
        id: item.item_id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price, // Assuming unit_price is the correct field
        total: item.total_price, // Assuming total_price is the correct field
        // Optional fields from WasmInvoiceViewModel can be added here if available in IInvoiceItem
        // category: item.category, // Example
        // itemType: item.itemType, // Example
      })),
      subtotal: dbData.subtotal,
      tax: dbData.tax,
      total: dbData.total_amount, // Map total_amount to total
      tenantCompany: tenantCompanyInfo, // Include fetched tenant company info
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

      // Fetch the compiled Wasm binary for the selected template
      if (!template.template_id) {
        throw new Error('Selected template does not have an ID.');
      }
      const wasmBuffer = await getCompiledWasm(template.template_id);

      // Map the fetched DB data to the ViewModel expected by the Wasm executor
      // Await the async mapping function
      const wasmInvoiceViewModel = await this.mapInvoiceDataToViewModel(dbInvoiceData);

      // Execute the Wasm template with the correctly mapped data
      const layoutElement = await executeWasmTemplate(wasmInvoiceViewModel, wasmBuffer);

      // Render the layout structure to HTML and CSS
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
