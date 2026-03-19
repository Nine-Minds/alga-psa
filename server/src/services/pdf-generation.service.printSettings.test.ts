import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceTemplateAst } from '@alga-psa/types';

vi.mock('server/src/lib/storage/StorageService', () => ({
  StorageService: {},
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  getInvoiceForRendering: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceTemplates: vi.fn(),
}));

vi.mock('server/src/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant, callback) => callback()),
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn(),
}));

vi.mock('@alga-psa/billing/lib/invoice-template-ast/evaluator', () => ({
  evaluateInvoiceTemplateAst: vi.fn(),
}));

vi.mock('@alga-psa/billing/lib/invoice-template-ast/server-render', () => ({
  renderInvoiceTemplateAstHtmlDocument: vi.fn(),
}));

vi.mock('./browser-pool.service', () => ({
  browserPoolService: {},
  BrowserPoolService: class BrowserPoolService {},
}));

vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({
  convertBlockContentToHTML: vi.fn(),
}));

vi.mock('@alga-psa/storage', () => ({
  StorageProviderFactory: {
    createProvider: vi.fn(),
  },
  generateStoragePath: vi.fn(),
}));

vi.mock('server/src/models/storage', () => ({
  FileStoreModel: {
    create: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@shared/workflow/streams/domainEventBuilders/documentGeneratedEventBuilders', () => ({
  buildDocumentGeneratedPayload: vi.fn(),
}));

import { PDFGenerationService as BillingPDFGenerationService } from '../../../packages/billing/src/services/pdfGenerationService';
import { browserPoolService as billingBrowserPoolService } from '../../../packages/billing/src/services/browserPoolService';
import { PDFGenerationService } from './pdf-generation.service';

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

describe('server PDFGenerationService print settings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes resolved format and margin options to page.pdf(...)', async () => {
    const page = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('server-pdf')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
    };
    const browserPool = {
      getBrowser: vi.fn().mockResolvedValue(browser),
      releaseBrowser: vi.fn().mockResolvedValue(undefined),
    };
    const service = new PDFGenerationService({} as any, browserPool as any, { tenant: 'tenant-1' });
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

  it('resolves identical print options in the server and billing PDF services for the same template settings', async () => {
    const templateAst = buildTemplateAst({
      paperPreset: 'A4',
      marginMm: 12,
      widthPx: 794,
      heightPx: 1123,
      paddingPx: 45,
    });

    const packagePage = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('package-pdf')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const packageBrowser = {
      newPage: vi.fn().mockResolvedValue(packagePage),
    };
    const originalBillingGetBrowser = billingBrowserPoolService.getBrowser;
    const originalBillingReleaseBrowser = billingBrowserPoolService.releaseBrowser;
    billingBrowserPoolService.getBrowser = vi.fn().mockResolvedValue(packageBrowser) as any;
    billingBrowserPoolService.releaseBrowser = vi.fn().mockResolvedValue(undefined) as any;
    const billingService = new BillingPDFGenerationService('tenant-1');

    const serverPage = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('server-pdf')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const serverBrowser = {
      newPage: vi.fn().mockResolvedValue(serverPage),
    };
    const serverBrowserPool = {
      getBrowser: vi.fn().mockResolvedValue(serverBrowser),
      releaseBrowser: vi.fn().mockResolvedValue(undefined),
    };
    const serverService = new PDFGenerationService({} as any, serverBrowserPool as any, { tenant: 'tenant-1' });

    try {
      await (billingService as any).generatePDFBuffer('<html><body>Invoice</body></html>', templateAst);
      await (serverService as any).generatePDFBuffer('<html><body>Invoice</body></html>', templateAst);

      expect(packagePage.pdf.mock.calls[0]?.[0]).toEqual(serverPage.pdf.mock.calls[0]?.[0]);
    } finally {
      billingBrowserPoolService.getBrowser = originalBillingGetBrowser;
      billingBrowserPoolService.releaseBrowser = originalBillingReleaseBrowser;
    }
  });

  it('generates a PDF successfully for a template with explicit paper preset and margin settings', async () => {
    const page = {
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('server-pdf')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: vi.fn().mockResolvedValue(page),
    };
    const browserPool = {
      getBrowser: vi.fn().mockResolvedValue(browser),
      releaseBrowser: vi.fn().mockResolvedValue(undefined),
    };
    const service = new PDFGenerationService({} as any, browserPool as any, { tenant: 'tenant-1' });
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
  });
});
