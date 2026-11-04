import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { user_id: 'u1', user_type: 'internal' } as Record<string, unknown>,
  load: vi.fn(),
  render: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) => fn(mocks.user, { tenant: 't1' }, ...args),
}));
vi.mock('@alga-psa/inventory/lib/rmaPrintData', async () => ({
  loadReadableRmaCases: mocks.load,
  buildRmaReturnSlipViewModel: (row: any) => ({ rma: { number: row.rma_number } }),
}));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerLocale: async () => 'en' }));
vi.mock('../src/services/registeredDocumentPdfService', () => ({ renderRegisteredDocumentPdf: mocks.render }));

import { downloadRmaReturnSlipPDF } from '../src/actions/rmaDocumentActions';

const ID = '11111111-1111-4111-8111-111111111111';

describe('downloadRmaReturnSlipPDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { user_id: 'u1', user_type: 'internal' };
    process.env.NEXTAUTH_URL = 'https://psa.test';
    mocks.render.mockResolvedValue({ pdf: Buffer.from('%PDF'), templateId: null });
  });

  it('renders the rma-return-slip document for a readable RMA', async () => {
    mocks.load.mockResolvedValue([{ rma_number: 'RMA-00007' }]);
    const result = await downloadRmaReturnSlipPDF(ID);
    expect(result).toEqual({ pdfData: [37, 80, 68, 70], rmaNumber: 'RMA-00007' });
    expect(mocks.render).toHaveBeenCalledWith('t1', 'rma-return-slip', { rma: { number: 'RMA-00007' } }, expect.objectContaining({ locale: 'en' }));
  });

  it('gives the same not-found answer for a missing/unreadable RMA, a malformed id and a client-portal user, and renders nothing', async () => {
    mocks.load.mockResolvedValue([null]);
    const unreadable = await downloadRmaReturnSlipPDF(ID);
    const malformed = await downloadRmaReturnSlipPDF('nope');
    mocks.user = { user_id: 'u2', user_type: 'client' };
    const portal = await downloadRmaReturnSlipPDF(ID);
    expect(unreadable).toEqual({ actionError: 'RMA not found' });
    expect(malformed).toEqual(unreadable);
    expect(portal).toEqual(unreadable);
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
