import { StorageService } from '../lib/storage/StorageService';
import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';
import { FileStore } from '../types/storage';
import { getInvoiceForRendering, getInvoiceTemplates } from '../lib/actions/invoiceActions';
import { TemplateRenderer } from '../components/billing-dashboard/TemplateRenderer';
import React from 'react';

interface PDFGenerationOptions {
  invoiceId: string;
  version?: number;
  cacheKey?: string;
}

export class PDFGenerationService {
  private readonly pdfCacheDir: string;

  constructor(
    private readonly storageService: StorageService,
    private config: {
      pdfCacheDir?: string;
    } = {}
  ) {
    this.pdfCacheDir = config.pdfCacheDir || '/tmp/pdf-cache';
  }

  async generateAndStore(options: PDFGenerationOptions): Promise<FileStore> {
    // Generate HTML content from template
    const htmlContent = await this.getInvoiceHtml(options.invoiceId);
    
    // Generate PDF buffer
    const pdfBuffer = await this.generatePDFBuffer(htmlContent);
    
    // Store PDF
    const fileRecord = await StorageService.storePDF(
      options.invoiceId,
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
    // Fetch invoice data and templates
    const [invoiceData, templates] = await Promise.all([
      getInvoiceForRendering(invoiceId),
      getInvoiceTemplates()
    ]);

    if (!invoiceData) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    // Use first template for now (can be made configurable)
    const template = templates[0];
    if (!template) {
      throw new Error('No invoice templates found');
    }

    // Render template directly using server component
    const fullHtml = await TemplateRenderer({
      template,
      invoiceId
    });
    return fullHtml;
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
