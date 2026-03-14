import type { InvoiceTemplateAst } from '@alga-psa/types';
import type { Page } from 'puppeteer';

import { createTenantKnex, runWithTenant } from '@alga-psa/db';

import { mapDbQuoteToViewModel } from '../lib/adapters/quoteAdapters';
import { evaluateInvoiceTemplateAst } from '../lib/invoice-template-ast/evaluator';
import { renderEvaluatedInvoiceTemplateAst } from '../lib/invoice-template-ast/react-renderer';
import { getStandardQuoteTemplateAstByCode } from '../lib/quote-template-ast/standardTemplates';
import { browserPoolService } from './browserPoolService';

interface QuotePDFGenerationOptions {
  quoteId: string;
  templateCode?: string;
  templateAst?: InvoiceTemplateAst;
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

  private async getQuoteHtml(options: QuotePDFGenerationOptions): Promise<string> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();
      const quoteViewModel = await mapDbQuoteToViewModel(knex, this.tenant, options.quoteId);

      if (!quoteViewModel) {
        throw new Error(`Quote ${options.quoteId} not found`);
      }

      const templateAst =
        options.templateAst ?? getStandardQuoteTemplateAstByCode(options.templateCode ?? 'standard-quote-default');

      if (!templateAst) {
        throw new Error('No quote template AST available for PDF generation');
      }

      const evaluation = evaluateInvoiceTemplateAst(
        templateAst,
        quoteViewModel as unknown as Record<string, unknown>
      );
      const rendered = await renderEvaluatedInvoiceTemplateAst(templateAst, evaluation);

      return `<!doctype html><html><head><meta charset=\"utf-8\" /><style>${rendered.css}</style></head><body>${rendered.html}</body></html>`;
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
