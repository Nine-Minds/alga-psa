import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as safeFetch from '@alga-psa/core/net/safeFetch';

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

import { escapeHtmlText, PDFGenerationService } from './pdfGenerationService';

const buildTemplateAst = ({
  paperPreset,
  marginMm,
  widthPx,
  heightPx,
  paddingPx,
}: {
  paperPreset?: 'Letter' | 'A4' | 'Legal';
  marginMm?: number;
  widthPx: number;
  heightPx: number;
  paddingPx: number;
}): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: 1,
  metadata: paperPreset && typeof marginMm === 'number' ? { printSettings: { paperPreset, marginMm } } : undefined,
  layout: {
    id: 'document-root',
    type: 'document',
    style: {
      inline: {
        width: `${widthPx}px`,
        height: `${heightPx}px`,
      },
    },
    children: [
      {
        id: 'page-root',
        type: 'section',
        style: {
          inline: {
            width: `${widthPx}px`,
            height: `${heightPx}px`,
            padding: `${paddingPx}px`,
          },
        },
        children: [],
      },
    ],
  },
});

describe('billing PDFGenerationService print settings', () => {
  beforeEach(() => {
    getBrowserMock.mockReset();
    releaseBrowserMock.mockReset();
  });

  it('escapes document metadata before it is interpolated into HTML', () => {
    expect(escapeHtmlText(`name & <script>\"x\" 'y'`)).toBe('name &amp; &lt;script&gt;&quot;x&quot; &#39;y&#39;');
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1/secret',
    'http://192.168.1.1/secret',
  ])('blocks Chromium requests to %s before producing a PDF', async (url) => {
    const abort = vi.fn();
    const proceed = vi.fn();
    let requestHandler: ((request: any) => void) | undefined;
    const page = {
      setJavaScriptEnabled: vi.fn().mockResolvedValue(undefined),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, handler: (request: any) => void) => {
        if (event === 'request') requestHandler = handler;
      }),
      setContent: vi.fn(async () => {
        expect(page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
        expect(page.setRequestInterception).toHaveBeenCalledWith(true);
        expect(requestHandler).toBeTypeOf('function');
        requestHandler!({ url: () => url, resourceType: () => 'document', abort, continue: proceed });
      }),
      pdf: vi.fn(async () => {
        expect(abort).toHaveBeenCalledWith('blockedbyclient');
        expect(proceed).not.toHaveBeenCalled();
        return Buffer.from('safe-pdf');
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browser = { newPage: vi.fn().mockResolvedValue(page) };
    getBrowserMock.mockResolvedValue(browser);
    releaseBrowserMock.mockResolvedValue(undefined);

    const service = new PDFGenerationService('tenant-1');
    const result = await (service as any).generatePDFBuffer(`<iframe src="${url}"></iframe>`);

    expect(result).toEqual(Buffer.from('safe-pdf'));
    expect(page.close).toHaveBeenCalledOnce();
    expect(releaseBrowserMock).toHaveBeenCalledWith(browser);
  });

  it('renders a legitimate image in a real PDF without contacting an internal image server', async () => {
    let connections = 0;
    const server = http.createServer((_request, response) => response.end('internal secret'));
    server.on('connection', () => { connections += 1; });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser: import('puppeteer').Browser | undefined;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const fetchPublicBytes = safeFetch.fetchPublicBytes;
    // Deterministic public CDN transport; retain the real DNS/IP and MIME validation.
    const fetchSpy = vi.spyOn(safeFetch, 'fetchPublicBytes').mockImplementation((url, options) =>
      fetchPublicBytes(url, {
        ...options,
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        request: async () => ({
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: (async function* () { yield png; })(),
        }),
      }),
    );
    try {
      const { BrowserPoolService } = await vi.importActual<typeof import('./browserPoolService')>('./browserPoolService');
      browser = await new BrowserPoolService(1).getBrowser();
      const page = await browser.newPage();
      getBrowserMock.mockResolvedValue({ newPage: async () => page });
      releaseBrowserMock.mockResolvedValue(undefined);
      const print = page.pdf.bind(page);
      vi.spyOn(page, 'pdf').mockImplementation(async (options) => {
        await page.waitForFunction(() => {
          const logo = document.querySelector<HTMLImageElement>('#logo');
          return logo?.complete && logo.naturalWidth === 1;
        }, { polling: 50, timeout: 5000 });
        expect(await page.evaluate(() => document.querySelector('#script-ran'))).toBeNull();
        return print(options);
      });
      const port = (server.address() as AddressInfo).port;
      const service = new PDFGenerationService('tenant-1');
      const buffer = await (service as any).generatePDFBuffer(`
        <h1>Customer document</h1><img id="logo" src="https://cdn.example.com/customer-logo.png">
        <img src="http://127.0.0.1:${port}/private.png">
        <iframe src="http://127.0.0.1:${port}/private"></iframe>
        <script>document.body.id = 'script-ran'; fetch('http://127.0.0.1:${port}/script')</script>
      `);
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect(page.pdf).toHaveBeenCalledOnce();
      expect(connections).toBe(0);
    } finally {
      fetchSpy.mockRestore();
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30000);

  it('passes resolved format and margin options to page.pdf(...)', async () => {
    const page = {
      setJavaScriptEnabled: vi.fn().mockResolvedValue(undefined),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('package-pdf')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
    };
    getBrowserMock.mockResolvedValue(browser);
    releaseBrowserMock.mockResolvedValue(undefined);

    const service = new PDFGenerationService('tenant-1');
    const templateAst = buildTemplateAst({
      paperPreset: 'Legal',
      marginMm: 18,
      widthPx: 816,
      heightPx: 1344,
      paddingPx: 68,
    });

    await (service as any).generatePDFBuffer('<html><body>Invoice</body></html>', templateAst);

    expect(page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(page.setContent).toHaveBeenCalledWith('<html><body>Invoice</body></html>', { waitUntil: 'domcontentloaded' });
    expect(page.pdf).toHaveBeenCalledWith({
      format: 'Legal',
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });
  });

  it('generates a PDF successfully for a template with explicit paper preset and margin settings', async () => {
    const page = {
      setJavaScriptEnabled: vi.fn().mockResolvedValue(undefined),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('package-pdf')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
    };
    getBrowserMock.mockResolvedValue(browser);
    releaseBrowserMock.mockResolvedValue(undefined);

    const service = new PDFGenerationService('tenant-1');
    const templateAst = buildTemplateAst({
      paperPreset: 'A4',
      marginMm: 12,
      widthPx: 794,
      heightPx: 1123,
      paddingPx: 45,
    });
    (service as any).getInvoiceHtml = vi.fn().mockResolvedValue({
      htmlContent: '<html><body>Invoice</body></html>',
      templateAst,
    });

    const pdfBuffer = await service.generatePDF({
      invoiceId: 'inv-1',
      userId: 'user-1',
    });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(page.pdf).toHaveBeenCalledWith({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });
  });

  it('preserves legacy templates without explicit print metadata by inferring fallback PDF options', async () => {
    const page = {
      setJavaScriptEnabled: vi.fn().mockResolvedValue(undefined),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('package-pdf')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
    };
    getBrowserMock.mockResolvedValue(browser);
    releaseBrowserMock.mockResolvedValue(undefined);

    const service = new PDFGenerationService('tenant-1');
    const legacyTemplateAst = buildTemplateAst({
      widthPx: 816,
      heightPx: 1056,
      paddingPx: 40,
    });
    (service as any).getInvoiceHtml = vi.fn().mockResolvedValue({
      htmlContent: '<html><body>Invoice</body></html>',
      templateAst: legacyTemplateAst,
    });

    const pdfBuffer = await service.generatePDF({
      invoiceId: 'inv-legacy',
      userId: 'user-1',
    });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(page.pdf).toHaveBeenCalledWith({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });
  });
});
