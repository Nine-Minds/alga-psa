import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceTemplateAst } from '@alga-psa/types';

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
}): InvoiceTemplateAst => ({
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

  it('passes resolved format and margin options to page.pdf(...)', async () => {
    const page = {
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
