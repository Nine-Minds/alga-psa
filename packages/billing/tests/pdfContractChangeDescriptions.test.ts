import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';

const fixture = vi.hoisted(() => ({ sources: [] as any[], tenant: '', query: null as any }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: { schema: { hasTable: async () => true } } }),
  runWithTenant: async (_tenant: string, fn: () => unknown) => fn(),
  tenantDb: (_knex: unknown, tenant: string) => {
    fixture.tenant = tenant;
    const query: any = {
      join: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(), select: vi.fn(async () => fixture.sources),
    };
    return { table: (name: string) => {
      if (name === 'contract_recurring_unit_adjustments as a') fixture.query = query;
      return query;
    } };
  },
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({}),
}));
vi.mock('../src/lib/adapters/invoiceAdapters.server', () => ({
  enrichInvoiceViewModelWithLocations: async (_knex: unknown, _tenant: string, view: unknown) => view,
}));
vi.mock('../src/services/browserPoolService', () => ({
  browserPoolService: { getBrowser: vi.fn(), releaseBrowser: vi.fn().mockResolvedValue(undefined) },
}));

import Invoice from '../src/models/invoice';
import { PDFGenerationService } from '../src/services/pdfGenerationService';
import { browserPoolService } from '../src/services/browserPoolService';

const templateAst = {
  kind: 'invoice-template-ast', version: TEMPLATE_AST_VERSION,
  bindings: { collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'items' } } },
  layout: {
    id: 'root', type: 'document', children: [{
      id: 'line-items', type: 'dynamic-table',
      repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
      columns: [
        { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
        { id: 'total', header: 'Amount', value: { type: 'path', path: 'total' }, format: 'currency' },
      ],
    }],
  },
} as TemplateAst;

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  // The server test lane resets mock implementations between parameterized cases.
  vi.mocked(browserPoolService.releaseBrowser).mockResolvedValue(undefined);
});

describe('PDF service canonical true-up output', () => {
  it.each([1, -1])('enriches a stored generic description for direction %s without changing invoice data', async (direction) => {
    const charge = {
      item_id: 'source-charge', description: 'Mid-period quantity change: Cabling',
      quantity: 1, unit_price: 12000, net_amount: direction * 7355, total_price: direction * 7355,
      adjustment_source_kind: 'contract_change', adjustment_source_id: 'revision-1', adjustment_source_revision: 1,
    };
    const invoice = {
      invoice_number: 'INV-TAKEOVER', invoice_date: '2026-10-13', due_date: '2026-11-13', currency_code: 'AUD',
      client: { name: 'Isolated PDF fixture', address: '' }, invoice_charges: [charge],
      subtotal: direction * 7355, tax: 0, total: direction * 7355,
    };
    const original = structuredClone(invoice);
    fixture.sources = [{
      item_id: charge.item_id, service_name: 'Cabling', currency_code: 'AUD',
      adjustment_period_start: new Date('2026-10-01T00:00:00Z'),
      mid_period_effective_date: new Date('2026-10-13T00:00:00Z'),
      adjustment_period_end: new Date('2026-11-01T00:00:00Z'),
      quantity_delta: direction, unit_rate_cents: '12000', covered_days: 19, full_period_days: 31,
      amount_cents: String(direction * 7355),
    }];
    vi.spyOn(Invoice, 'getFullInvoiceById').mockResolvedValue(invoice as any);
    vi.spyOn(Invoice, 'getAllTemplates').mockResolvedValue([{ template_id: 'template-1', templateAst }] as any);
    const service = new PDFGenerationService('tenant-1');
    vi.spyOn(service, 'resolveRenderLocale').mockResolvedValue('en');
    vi.spyOn(service, 'resolveRenderCountry').mockResolvedValue('MM/dd/yyyy' as any);
    vi.spyOn(service as any, 'enrichWithTenantClient').mockImplementation(async (_knex, value) => value);
    const preview = await service.renderInvoicePreview({ invoiceId: 'invoice-1', templateAst });
    const explanation = `Cabling: ${direction > 0 ? 'increase (+1' : 'credit (-1'} units); 2026-10-13 through 2026-11-01 (end date exclusive); full-period rate AUD $120.00; prorated 19/31 days`;
    expect(preview.html).toContain(explanation);

    const setContent = vi.fn();
    const page = { setContent, pdf: vi.fn().mockResolvedValue(Buffer.from('pdf-test')), close: vi.fn().mockResolvedValue(undefined) };
    let browser: any;
    try {
      // Optional local evidence uses real Chromium with the production PDF method;
      // database reads remain isolated fixtures, with no app server or storage writes.
      if (process.env.CONTRACT_PDF_EVIDENCE_DIR) {
        const puppeteer = (await import('puppeteer')).default;
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        vi.mocked(browserPoolService.getBrowser).mockResolvedValue(browser);
      } else {
        vi.mocked(browserPoolService.getBrowser).mockResolvedValue({ newPage: async () => page } as any);
      }
      const pdf = await service.generatePDF({ invoiceId: 'invoice-1', templateId: 'template-1', userId: 'fixture-user' });
      if (process.env.CONTRACT_PDF_EVIDENCE_DIR) {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        const { execFileSync } = await import('node:child_process');
        const { join } = await import('node:path');
        mkdirSync(process.env.CONTRACT_PDF_EVIDENCE_DIR, { recursive: true });
        const file = join(process.env.CONTRACT_PDF_EVIDENCE_DIR, direction > 0 ? 'increase.pdf' : 'credit.pdf');
        writeFileSync(file, pdf);
        const text = execFileSync('pdftotext', ['-raw', file, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
        expect(text).toContain(explanation);
        expect(text).toMatch(direction > 0 ? /A\$73\.55/ : /-\s*A\$73\.55/);
      } else {
        expect(setContent.mock.calls[0][0]).toContain(explanation);
        expect(page.pdf).toHaveBeenCalledOnce();
      }
    } finally {
      await browser?.close();
    }
    expect(invoice).toEqual(original);
    expect(fixture.tenant).toBe('tenant-1');
    expect(fixture.query.where).toHaveBeenCalledWith('c.invoice_id', 'invoice-1');
    expect(fixture.query.select.mock.calls[0]).toContain('a.mid_period_effective_date');
  });
});
