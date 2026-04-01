import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';

vi.mock('@alga-psa/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<unknown>) => callback()),
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  getInvoiceForRendering: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceTemplates: vi.fn(),
  getInvoiceTemplate: vi.fn(),
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn(),
}));

vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({
  convertBlockContentToHTML: vi.fn(),
}));

vi.mock('@alga-psa/billing/lib/invoice-template-ast/evaluator', () => ({
  evaluateTemplateAst: vi.fn(),
}));

vi.mock('@alga-psa/billing/lib/invoice-template-ast/server-render', () => ({
  renderTemplateAstHtmlDocument: vi.fn(),
}));

vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: { createProvider: vi.fn() },
  generateStoragePath: vi.fn(),
  FileStoreModel: { create: vi.fn() },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildDocumentGeneratedPayload: vi.fn(),
}));

import { PDFGenerationService } from '@alga-psa/billing/services';
import { browserPoolService } from '../../../packages/billing/src/services/browserPoolService';

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

describe('PDFGenerationService print settings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes resolved format and margin options to page.pdf(...)', async () => {
    const page = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('pdf-output')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
    };
    const originalGetBrowser = browserPoolService.getBrowser;
    const originalReleaseBrowser = browserPoolService.releaseBrowser;
    browserPoolService.getBrowser = vi.fn().mockResolvedValue(browser) as any;
    browserPoolService.releaseBrowser = vi.fn().mockResolvedValue(undefined) as any;

    const service = new PDFGenerationService('tenant-1');
    const templateAst = buildTemplateAst({
      paperPreset: 'Legal',
      marginMm: 18,
      widthPx: 816,
      heightPx: 1344,
      paddingPx: 68,
    });

    try {
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
    } finally {
      browserPoolService.getBrowser = originalGetBrowser;
      browserPoolService.releaseBrowser = originalReleaseBrowser;
    }
  });

  it('generates a PDF successfully for a template with explicit paper preset and margin settings', async () => {
    const page = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('pdf-output')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
    };
    const originalGetBrowser = browserPoolService.getBrowser;
    const originalReleaseBrowser = browserPoolService.releaseBrowser;
    browserPoolService.getBrowser = vi.fn().mockResolvedValue(browser) as any;
    browserPoolService.releaseBrowser = vi.fn().mockResolvedValue(undefined) as any;

    const service = new PDFGenerationService('tenant-1');
    const templateAst = buildTemplateAst({
      paperPreset: 'Letter',
      marginMm: 16,
      widthPx: 816,
      heightPx: 1056,
      paddingPx: 60,
    });
    (service as any).getInvoiceHtml = vi.fn().mockResolvedValue({
      htmlContent: '<html><body>Invoice</body></html>',
      templateAst,
    });

    try {
      const pdfBuffer = await service.generatePDF({
        invoiceId: 'inv-1',
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
    } finally {
      browserPoolService.getBrowser = originalGetBrowser;
      browserPoolService.releaseBrowser = originalReleaseBrowser;
    }
  });
});
