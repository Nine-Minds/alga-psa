// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InvoicePreviewPanel from './InvoicePreviewPanel';

const queueMock = vi.hoisted(() => vi.fn());
const runMock = vi.hoisted(() => vi.fn());
const outcomeMock = vi.hoisted(() => vi.fn());
const voidMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => ({ enabled: false, value: false, loading: false }) }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../actions/voidInvoiceActions', () => ({ voidInvoice: voidMock }));
vi.mock('../../../actions/accountingSyncActions', () => ({
  queueInvoiceSync: queueMock,
  runAccountingSyncNow: runMock,
  getInvoiceSyncOutcome: outcomeMock,
  resolveAccountingDriftReExport: vi.fn(),
  resolveAccountingDriftAccept: vi.fn(),
}));
vi.mock('../../invoices/useInvoiceSyncStatuses', () => ({
  useInvoiceSyncStatuses: () => ({ statuses: { 'inv-1': { state: 'not_synced', provider: 'quickbooks_online' } }, hidden: false }),
}));
vi.mock('../../invoices/InvoiceSyncBadge', () => ({ InvoiceSyncBadge: () => null, qboInvoiceDeepLink: vi.fn(), xeroInvoiceDeepLink: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  getEnrichedInvoiceViewModel: vi.fn(async () => ({ invoiceNumber: 'INV-1', taxSource: 'internal', items: [], customer: {}, tenantClient: {} })),
  getInvoicePurchaseOrderSummary: vi.fn(async () => null),
  getResolvedInvoiceTemplateId: vi.fn(async () => null),
}));
vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({ getInvoiceAnnotations: vi.fn(async () => []) }));
vi.mock('@alga-psa/billing/actions/quoteActions', () => ({ getQuoteByConvertedInvoiceId: vi.fn(async () => null) }));
vi.mock('./InvoiceHistorySection', () => ({ default: () => null }));
vi.mock('../TemplateRenderer', () => ({ TemplateRenderer: () => <div /> }));
vi.mock('../PaperInvoice', () => ({ default: (p: any) => <div>{p.children}</div> }));
vi.mock('./DraftInvoiceDetailsCard', () => ({ default: () => null }));
vi.mock('./DraftInvoiceAdjustmentsCard', () => ({ default: () => null }));
vi.mock('./PurchaseOrderSummaryBanner', () => ({ PurchaseOrderSummaryBanner: () => null }));
vi.mock('../CreditExpirationInfo', () => ({ default: () => null }));
vi.mock('../CreditApplicationUI', () => ({ default: () => null }));
vi.mock('../../invoices/InvoiceTaxSourceBadge', () => ({ InvoiceTaxSourceBadge: () => null }));

function renderPanel(status: string, extra: Record<string, unknown> = {}) {
  return render(
    <InvoicePreviewPanel
      invoiceId="inv-1"
      templates={[]}
      selectedTemplateId={null}
      onTemplateChange={vi.fn()}
      isFinalized
      invoiceSummary={{ status } as any}
      {...extra}
    />
  );
}

async function clickSync() {
  fireEvent.click(await screen.findByRole('button', { name: /Sync to QuickBooks/ }));
}

describe('InvoicePreviewPanel Sync to <provider> button', () => {
  beforeEach(() => {
    cleanup();
    queueMock.mockReset();
    runMock.mockReset();
    outcomeMock.mockReset();
    queueMock.mockResolvedValue({ queued: true, opId: 'op-1' });
    runMock.mockResolvedValue({ ran: true, status: 'succeeded' });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(['cancelled', 'paid'])('is hidden for a %s invoice', async (status) => {
    renderPanel(status);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Sync to QuickBooks/ })).toBeNull());
  });

  it('is shown for a sent invoice', async () => {
    renderPanel('sent');
    expect(await screen.findByRole('button', { name: /Sync to QuickBooks/ })).toBeTruthy();
  });

  it('shows the action error and does not run the cycle when the invoice is refused', async () => {
    queueMock.mockResolvedValue({ queued: false, error: 'Voided invoices are not synced.' });
    renderPanel('sent');
    await clickSync();
    expect(await screen.findByText('Voided invoices are not synced.')).toBeTruthy();
    expect(runMock).not.toHaveBeenCalled();
  });

  it.each([
    ['paid', 'Paid invoices are not synced to QuickBooks.'],
    ['cancelled', 'Voided or cancelled invoices are not synced to QuickBooks.'],
    ['not_found', 'Invoice not found.'],
  ])('renders the localized message for refusal reason %s', async (reason, message) => {
    queueMock.mockResolvedValue({ queued: false, reason, error: 'raw english from server' });
    renderPanel('sent');
    await clickSync();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText('raw english from server')).toBeNull();
  });

  it('reports a cycle that did not run, never success', async () => {
    runMock.mockResolvedValue({ ran: false, status: 'skipped', error: 'Another cycle is running' });
    renderPanel('sent');
    await clickSync();
    expect(await screen.findByText('QuickBooks sync did not run: Another cycle is running')).toBeTruthy();
    expect(outcomeMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ outcome: 'synced' }, 'Invoice synced to QuickBooks.'],
    [{ outcome: 'failed', reason: 'Account is closed' }, 'QuickBooks sync failed: Account is closed'],
    [{ outcome: 'skipped', reason: 'Too many attempts' }, 'Invoice was skipped and not sent to QuickBooks: Too many attempts'],
    [{ outcome: 'pending' }, 'Invoice is queued for QuickBooks sync; it has not been processed yet.'],
  ])('shows the outcome %j', async (outcome, message) => {
    outcomeMock.mockResolvedValue(outcome);
    renderPanel('sent');
    await clickSync();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(outcomeMock).toHaveBeenCalledWith('inv-1', 'op-1');
  });

  it.each(['failed', 'aborted'])(
    'reports a %s cycle with its reason when the invoice was not processed',
    async (status) => {
      runMock.mockResolvedValue({ ran: true, status, error: 'QBO API Error during changeDataCapture: Service Unavailable' });
      outcomeMock.mockResolvedValue({ outcome: 'pending' });
      renderPanel('sent');
      await clickSync();
      expect(
        await screen.findByText(
          'QuickBooks sync failed: QBO API Error during changeDataCapture: Service Unavailable The invoice was not sent; it stays queued and is retried on the next sync.'
        )
      ).toBeTruthy();
      expect(screen.queryByText(/has not been processed yet/)).toBeNull();
    }
  );

  it('lets the op outcome win over a failed cycle when the invoice itself was processed', async () => {
    runMock.mockResolvedValue({ ran: true, status: 'failed', error: 'later step failed' });
    outcomeMock.mockResolvedValue({ outcome: 'synced' });
    renderPanel('sent');
    await clickSync();
    expect(await screen.findByText('Invoice synced to QuickBooks.')).toBeTruthy();
  });

  it('hides the button once the invoice is voided from this panel and tells the parent', async () => {
    voidMock.mockResolvedValue({ success: true });
    const onInvoiceVoided = vi.fn();
    renderPanel('sent', {
      onInvoiceVoided,
      templates: [{ template_id: 'tpl-1', name: 'Standard', isStandard: true }],
      selectedTemplateId: 'tpl-1'
    });
    expect(await screen.findByRole('button', { name: /Sync to QuickBooks/ })).toBeTruthy();
    await waitFor(() => expect(document.getElementById('invoice-void-button')).toBeTruthy());
    fireEvent.click(document.getElementById('invoice-void-button')!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'duplicate' } });
    fireEvent.click(document.getElementById('void-invoice-confirm-button')!);
    await waitFor(() => expect(voidMock).toHaveBeenCalledWith('inv-1', 'duplicate'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Sync to QuickBooks/ })).toBeNull());
    expect(onInvoiceVoided).toHaveBeenCalledTimes(1);
  });
});
