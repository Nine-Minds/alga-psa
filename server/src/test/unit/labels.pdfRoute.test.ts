import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabelBatchLayout, LabelPrintItem, ResolvedLabelTemplate } from '@alga-psa/billing/services';
import type {
  TicketLabelSubject,
  TicketLinkedAssetLabelParts,
} from '@alga-psa/assets/lib/ticketLinkedAssetLabels';
import type { LabelClass, LabelRequestContext, LabelViewModelProvider } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  locale: 'fr',
  coreCount: 1,
  ticketViewModels: vi.fn<LabelViewModelProvider['getLabelViewModels']>(),
  resolveTemplate: vi.fn<(
    tenant: string,
    labelClass: LabelClass,
    templateId?: string | null
  ) => Promise<ResolvedLabelTemplate>>(),
  linkedAssets: vi.fn<(
    context: LabelRequestContext,
    subjects: ReadonlyArray<TicketLabelSubject>,
    options: { formatCpuCoreCount?: (count: number) => string }
  ) => Promise<Array<TicketLinkedAssetLabelParts | null>>>(),
  renderPdf: vi.fn<(
    tenant: string,
    items: readonly LabelPrintItem[],
    layout: LabelBatchLayout,
    options: { locale?: string }
  ) => Promise<{ pdf: Buffer; labels: number; sheets: number }>>(),
}));

vi.mock('@alga-psa/auth', () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  withAuth: (
    action: (
      user: { user_type: string },
      context: { tenant: string },
      body: Record<string, unknown>,
      baseUrl: string
    ) => Promise<unknown>,
  ) => (body: Record<string, unknown>, baseUrl: string) =>
    action({ user_type: 'internal' }, { tenant: 'tenant-1' }, body, baseUrl),
}));
vi.mock('@alga-psa/billing/services', async () => ({
  LabelLayoutError: (await import('@alga-psa/billing/lib/label-batch/layout')).LabelLayoutError,
  LabelRenderError: (await import('@alga-psa/billing/lib/label-batch/renderLabelBatchHtml')).LabelRenderError,
  renderLabelBatchPdf: mocks.renderPdf,
  resolveLabelTemplateForTenant: mocks.resolveTemplate,
}));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/ui/lib/i18n/serverOnly')>(),
  getServerLocale: async () => mocks.locale,
}));
vi.mock('@alga-psa/tickets/lib/labelViewModelProvider', () => ({
  ticketLabelViewModelProvider: {
    entityType: 'ticket',
    labelClass: 'ticket-work-tag',
    getLabelViewModels: mocks.ticketViewModels,
  },
}));
vi.mock('@alga-psa/assets/lib/ticketLinkedAssetLabels', () => ({
  getTicketLinkedAssetLabelParts: mocks.linkedAssets,
}));
vi.mock('@alga-psa/assets/lib/labelViewModelProvider', () => ({ assetLabelViewModelProvider: {} }));
vi.mock('@alga-psa/inventory/lib/labelViewModelProvider', () => ({ stockUnitLabelViewModelProvider: {} }));
vi.mock('@alga-psa/inventory/lib/rmaLabelViewModelProvider', () => ({ rmaLabelViewModelProvider: {} }));
vi.mock('@alga-psa/projects/lib/stagingLabelViewModelProvider', () => ({ stagingContainerLabelViewModelProvider: {} }));

import { LabelLayoutError } from '@alga-psa/billing/services';
import { POST } from '../../app/api/labels/pdf/route';

const ticketId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';
const templateCode = 'standard-ticket-customer-worksheet';

const request = () => new Request('https://psa.example.com/api/labels/pdf', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    labelClass: 'ticket-work-tag',
    templateCode,
    labels: [{ recordId: ticketId, linkedAssetId: assetId }],
  }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXTAUTH_URL', 'https://psa.example.com');
  mocks.locale = 'fr';
  mocks.coreCount = 1;
  mocks.resolveTemplate.mockResolvedValue({ ok: true, source: 'explicit', templateCode });
  mocks.ticketViewModels.mockImplementation(async (context, ids) => ids.map((recordId) => ({
    labelClass: 'ticket-work-tag',
    entityType: 'ticket',
    recordId,
    url: `${context.baseUrl}/msp/tickets/${recordId}`,
    identifier: 'TIC32108',
    code128Value: null,
    title: 'Customer desktop',
    clientName: 'Customer',
    detail: 'Hardware',
    secondaryIdentifier: null,
    serialSuffix: null,
    ticketDescription: context.includeWorksheetDetails ? 'Customer report' : null,
  })));
  mocks.linkedAssets.mockImplementation(async (_context, subjects, { formatCpuCoreCount }) => {
    if (!formatCpuCoreCount) throw new Error('The route did not provide a CPU core-count formatter');
    const cpuLine = `Example CPU / ${formatCpuCoreCount(mocks.coreCount)}`;
    return subjects.map(() => ({
      assetId,
      assetTag: 'CFD-DC-2021',
      serialSuffix: null,
      assetSerialNumber: '1234567',
      custodyLocation: null,
      nextAction: null,
      linkedAssetInfo: {
        assetId,
        name: 'Customer desktop',
        manufacturer: 'Example',
        model: 'Workstation',
        osLine: 'Windows',
        cpuLine,
        ramLine: '16 GB',
        storageLine: '512 GB SSD',
      },
    }));
  });
  mocks.renderPdf.mockResolvedValue({ pdf: Buffer.from('%PDF-test'), labels: 1, sheets: 1 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('worksheet PDF route', () => {
  it.each([
    ['fr', 1, '1 cœur'],
    ['fr', 8, '8 cœurs'],
    ['it', 1, '1 nucleo'],
    ['it', 8, '8 nuclei'],
    ['pl', 2, '2 rdzenie'],
    ['pl', 5, '5 rdzeni'],
  ])('passes %s locale and localized %i-core asset details to the renderer', async (locale, count, coreLabel) => {
    mocks.locale = locale;
    mocks.coreCount = count;

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(mocks.ticketViewModels).toHaveBeenCalledWith(
      expect.objectContaining({ includeWorksheetDetails: true }),
      [ticketId],
    );
    expect(mocks.linkedAssets).toHaveBeenCalledWith(
      expect.objectContaining({ includeWorksheetDetails: true }),
      [{ recordId: ticketId, linkedAssetId: assetId }],
      expect.objectContaining({ formatCpuCoreCount: expect.any(Function) }),
    );
    expect(mocks.renderPdf).toHaveBeenCalledWith(
      'tenant-1',
      [expect.objectContaining({
        viewModel: expect.objectContaining({
          secondaryIdentifier: 'CFD-DC-2021',
          assetSerialNumber: '1234567',
          ticketDescription: 'Customer report',
          linkedAsset: expect.objectContaining({ assetId, cpuLine: `Example CPU / ${coreLabel}` }),
        }),
      })],
      expect.objectContaining({ kind: 'one-per-page' }),
      { locale },
    );
  });

  it('returns structured worksheet clipping errors to the print dialog', async () => {
    mocks.renderPdf.mockRejectedValueOnce(new LabelLayoutError('Text is clipped', {
      errorCode: 'worksheetTextOverflow',
      worksheetNumbers: [1],
    }));

    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: 'Text is clipped',
      errorCode: 'worksheetTextOverflow',
      worksheetNumbers: [1],
    });
  });
});
