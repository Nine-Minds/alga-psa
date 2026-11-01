/**
 * RMA print outputs, end to end without a database: the RMA work tag through the label batch PDF path
 * (the same renderLabelBatchHtml -> renderHtmlToPdf pipeline `printLabels` uses) and the return slip through
 * the billing document action `downloadRmaReturnSlipPDF`. Only the data/auth boundary is faked (the RMA row,
 * the signed-in user, the tenant branding row); template resolution, view model building, HTML render and
 * the Chromium PDF are real, so this needs a launchable Chromium like labelBatch.e2e.test.ts.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordUrl, type IRmaCase } from '@alga-psa/types';

const state = vi.hoisted(() => ({ row: null as unknown, loadArgs: [] as unknown[] }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) =>
    fn({ user_id: 'u1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerLocale: async () => 'en' }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_k: unknown, fn: (t: unknown) => unknown) => fn({})),
}));
vi.mock('@alga-psa/inventory/lib/rmaPrintData', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/inventory/lib/rmaPrintData')>('@alga-psa/inventory/lib/rmaPrintData');
  return {
    ...actual,
    loadReadableRmaCases: vi.fn(async (...args: unknown[]) => {
      state.loadArgs = args;
      return [state.row];
    }),
  };
});
vi.mock('../src/lib/adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: vi.fn(async () => ({ name: 'Example MSP', logo_url: null })),
}));
vi.mock('../src/lib/document-templates/storage', () => ({ fetchTenantDefaultTemplate: vi.fn(async () => null) }));

import { buildRmaLabelViewModel } from '@alga-psa/inventory/lib/rmaPrintData';
import { browserPoolService } from '../src/services/browserPoolService';
import { renderHtmlToPdf } from '../src/services/labelPdfService';
import { renderLabelBatchHtml } from '../src/lib/label-batch/renderLabelBatchHtml';
import { downloadRmaReturnSlipPDF } from '../src/actions/rmaDocumentActions';

const BASE = 'https://psa.example.com';
const RMA_ID = '0e7f4c70-0000-4000-8000-000000000001';

const rmaRow = {
  rma_id: RMA_ID,
  rma_number: 'RMA-00007',
  rma_reference: 'DELL-5521',
  status: 'sent_to_vendor',
  returned_unit_id: null,
  asset_id: 'a1b2c3d4-0000-4000-8000-000000000002',
  asset_name: 'Dell Latitude 7440',
  asset_serial_number: 'SN12345678',
  asset_tag: 'AT-000123',
  ticket_number: 'TIC-1042',
  client_name: 'Emerald City Dental',
  vendor_name: 'Dell Technologies',
  return_by: '2026-11-15',
  return_ship_to: 'Dell RMA Dept\n1 Dell Way\nRound Rock, TX',
  outbound_carrier: 'UPS',
  outbound_tracking_number: '1Z999AA10123456784',
} as unknown as IRmaCase;

const isPdf = (b: Buffer | Uint8Array) => Buffer.from(b).subarray(0, 5).toString('latin1') === '%PDF-';

beforeEach(() => {
  state.row = rmaRow;
  process.env.NEXTAUTH_URL = BASE;
});
afterAll(async () => {
  await browserPoolService.cleanup();
});

describe('RMA print outputs (real Chromium PDF)', () => {
  it('renders the RMA work tag through the label batch PDF path', async () => {
    const viewModel = buildRmaLabelViewModel(rmaRow, BASE);
    expect(viewModel.url).toBe(recordUrl('rma', RMA_ID, BASE));
    const { html, printOptions } = await renderLabelBatchHtml(
      [{ viewModel }],
      { kind: 'one-per-page', pageSize: { width: 4, height: 2, unit: 'in' } },
      { tenantClient: { name: 'Example MSP', logoUrl: null } },
    );
    expect(html).toContain('RMA-00007');
    const pdf = await renderHtmlToPdf(html, printOptions);
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  }, 120_000);

  it('renders the return slip PDF through downloadRmaReturnSlipPDF', async () => {
    const result: any = await (downloadRmaReturnSlipPDF as any)(RMA_ID);
    expect(result.actionError).toBeUndefined();
    expect(result.rmaNumber).toBe('RMA-00007');
    const bytes = Buffer.from(result.pdfData);
    expect(isPdf(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(1000);
    // The action asks the inventory read gate for exactly this RMA.
    expect((state.loadArgs[1] as string[])).toEqual([RMA_ID]);
  }, 120_000);

  it('returns the same not-found result for a malformed id and an unreadable RMA, without rendering', async () => {
    const bad: any = await (downloadRmaReturnSlipPDF as any)('not-a-uuid');
    state.row = null;
    const missing: any = await (downloadRmaReturnSlipPDF as any)(RMA_ID);
    expect(bad).toEqual(missing);
    expect(bad.pdfData).toBeUndefined();
  });
});
