import { StorageService } from '../lib/storage/StorageService';
import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';
import { FileStore } from '../types/storage';
import { getInvoiceForRendering } from '../lib/actions/invoiceQueries';
import { getInvoiceTemplates } from '../lib/actions/invoiceTemplates';
import { renderTemplateCore } from '../components/billing-dashboard/TemplateRendererCore';
import React from 'react';
import { runWithTenant, createTenantKnex } from '../lib/db';

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

  private async getInvoiceHtml(invoiceId: string): Promise<string> {
    // Run all database operations with tenant context
    return runWithTenant(this.tenant, async () => {
      // Fetch invoice data and company's template
    const [invoiceData, templates] = await Promise.all([
      getInvoiceForRendering(invoiceId),
      getInvoiceTemplates()
    ]);

    if (!invoiceData) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    // Get company's selected template or default template
    const { knex } = await createTenantKnex();
    const company = await knex('companies')
      .where({ company_id: invoiceData.company_id })
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

      // Render template using core renderer
      const rendered = renderTemplateCore(template, invoiceData);
      return `
        <html>
          <head>
            <style>${rendered.styles}</style>
          </head>
          <body>${rendered.html}</body>
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
