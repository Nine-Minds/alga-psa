import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBrowserMock, releaseBrowserMock } = vi.hoisted(() => ({
  getBrowserMock: vi.fn(),
  releaseBrowserMock: vi.fn(),
}));

vi.mock('./browserPoolService', () => ({
  browserPoolService: {
    getBrowser: getBrowserMock,
    releaseBrowser: releaseBrowserMock,
  },
}));

import { PDFGenerationService } from './pdfGenerationService';

const stubBrowser = () => {
  const page = {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(Buffer.from('pdf')),
    close: vi.fn().mockResolvedValue(undefined),
  };
  getBrowserMock.mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page) });
  releaseBrowserMock.mockResolvedValue(undefined);
  return page;
};

const buildService = (renderedLocale: string | null) => {
  const service = new PDFGenerationService('tenant-1');
  (service as any).resolveRecipientClientId = vi.fn().mockResolvedValue('client-1');
  (service as any).resolveRenderedLocale = vi.fn().mockResolvedValue(renderedLocale);
  return service;
};

describe('PDFGenerationService recipient locale', () => {
  beforeEach(() => {
    getBrowserMock.mockReset();
    releaseBrowserMock.mockReset();
  });

  it('renders an invoice in the recipient locale and reports it back', async () => {
    stubBrowser();
    const service = buildService('de');
    const getInvoiceHtml = vi.fn().mockResolvedValue({
      htmlContent: '<html><body>Rechnung</body></html>',
      templateAst: null,
      templateId: 'tmpl-1',
      templateVersion: 2,
    });
    (service as any).getInvoiceHtml = getInvoiceHtml;

    const rendered = await (service as any).renderPdf({ invoiceId: 'inv-1', userId: 'user-1' });

    expect(getInvoiceHtml).toHaveBeenCalledWith('inv-1', undefined, 'de');
    // The locale the document was rendered in is what gets filed against it —
    // never re-resolved after the fact.
    expect(rendered.renderedLocale).toBe('de');
  });

  it('threads the recipient locale into quote and sales-order renders', async () => {
    stubBrowser();
    const service = buildService('fr');
    const getQuoteHtml = vi.fn().mockResolvedValue({
      htmlContent: '<html><body>Devis</body></html>',
      templateAst: null,
      templateId: null,
      templateVersion: null,
    });
    const getSalesOrderHtml = vi.fn().mockResolvedValue({
      htmlContent: '<html><body>Commande</body></html>',
      templateAst: null,
      templateId: null,
      templateVersion: null,
    });
    (service as any).getQuoteHtml = getQuoteHtml;
    (service as any).getSalesOrderHtml = getSalesOrderHtml;

    await (service as any).renderPdf({ quoteId: 'quote-1', userId: 'user-1' });
    await (service as any).renderPdf({ salesOrderId: 'so-1', userId: 'user-1' });

    expect(getQuoteHtml.mock.calls[0]?.[1]).toBe('fr');
    expect(getSalesOrderHtml.mock.calls[0]?.[1]).toBe('fr');
  });

  it('falls back to English when no recipient locale resolves', async () => {
    stubBrowser();
    const service = buildService(null);
    const getInvoiceHtml = vi.fn().mockResolvedValue({
      htmlContent: '<html><body>Invoice</body></html>',
      templateAst: null,
      templateId: null,
      templateVersion: null,
    });
    (service as any).getInvoiceHtml = getInvoiceHtml;

    const rendered = await (service as any).renderPdf({ invoiceId: 'inv-2', userId: 'user-1' });

    expect(getInvoiceHtml).toHaveBeenCalledWith('inv-2', undefined, 'en');
    expect(rendered.renderedLocale).toBe('en');
  });

  it('renders rather than failing when the locale lookup throws', async () => {
    stubBrowser();
    const service = new PDFGenerationService('tenant-1');
    (service as any).resolveRecipientClientId = vi.fn().mockRejectedValue(new Error('db down'));
    const getInvoiceHtml = vi.fn().mockResolvedValue({
      htmlContent: '<html><body>Invoice</body></html>',
      templateAst: null,
      templateId: null,
      templateVersion: null,
    });
    (service as any).getInvoiceHtml = getInvoiceHtml;

    const rendered = await (service as any).renderPdf({ invoiceId: 'inv-3', userId: 'user-1' });

    expect(rendered.renderedLocale).toBe('en');
    expect(Buffer.isBuffer(rendered.buffer)).toBe(true);
  });
});
