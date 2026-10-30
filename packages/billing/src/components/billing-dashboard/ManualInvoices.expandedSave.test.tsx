// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(), warnings: vi.fn(async () => []), lineItems: vi.fn(async (_invoiceId?: string): Promise<any> => []),
  snapshot: vi.fn(async (_invoiceId?: string): Promise<any> => null), locations: vi.fn(async (): Promise<any> => []), profiles: vi.fn(async (): Promise<any> => []),
}));
vi.mock('../../actions/invoiceExportWarnings', () => ({ getInvoiceAdjustmentExportWarnings: mocks.warnings }));
vi.mock('@alga-psa/billing/actions/manualInvoiceActions', () => ({ generateManualInvoice: vi.fn(), getClientBillingEmailStatus: vi.fn(async () => ({ hasBillingEmail: true })) }));
vi.mock('@alga-psa/billing/actions/salesOrderInvoicingActions', () => ({ generateInvoiceForSalesOrder: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ updateInvoiceManualItems: mocks.update }));
vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({ getInvoiceLineItems: mocks.lineItems, getInvoiceAdjustmentSnapshot: mocks.snapshot }));
vi.mock('@alga-psa/billing/actions/billingClientLocationActions', () => ({ getActiveClientLocationsForBillingRecoverable: mocks.locations }));
vi.mock('@alga-psa/billing/actions/taxRateActions', () => ({ getTaxRates: vi.fn(async () => []) }));
vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({ getClientBillingProfilesForBilling: mocks.profiles }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@alga-psa/ui/context', () => ({ useQuickAddClient: () => ({ renderQuickAddClient: () => null }) }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ __esModule: true, default: ({ id, options = [], value, onValueChange }: any) => <select id={id} value={value ?? ''} onChange={(e) => onValueChange(e.target.value)}><option value="">Select</option>{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({ default: () => null }));
vi.mock('./contracts/ServicePicker', () => ({ ServicePicker: ({ id, options = [], value, onChange }: any) => <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}><option value="">Select</option>{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: (props: any) => <input type="checkbox" {...props} /> }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: any) => <div role="alert">{children}</div>, AlertDescription: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_k: string, o?: Record<string, unknown>) => (o?.defaultValue as string | undefined) ?? _k }), useFormatters: () => ({ formatCurrency: (v: number) => `$${v.toFixed(2)}` }) }));

import ManualInvoices from './ManualInvoices';
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.snapshot.mockImplementation(async (requestedInvoiceId?: string) => {
    const invoiceId = requestedInvoiceId ?? invoice.invoice_id;
    const invoiceCharges = await mocks.lineItems(invoiceId);
    if (!Array.isArray(invoiceCharges)) return invoiceCharges;
    return { ...invoice, invoice_id: invoiceId, invoice_charges: invoiceCharges };
  });
  mocks.locations.mockResolvedValue([]);
  mocks.profiles.mockResolvedValue([]);
});

const invoice: any = {
  invoice_id: 'invoice-1', client_id: 'client-1', invoice_number: 'INV-1', currencyCode: 'USD', is_manual: false,
  draft_adjustment_revision: 7, subtotal: 390000, total_amount: 390000,
  invoice_charges: [{ item_id: 'generated-1', invoice_id: 'invoice-1', service_id: 'svc-1', description: 'Recurring', quantity: 1, unit_price: 390000, total_price: 390000, net_amount: 390000, tax_amount: 0, is_manual: false, is_discount: false, is_taxable: false }],
};
const services: any[] = [{ service_id: 'svc-1', service_name: 'Support', item_kind: 'service', is_active: true, default_rate: 5000, prices: [{ currency_code: 'USD', rate: 5000 }] }];
const renderDraft = (draft = invoice, onSaved?: () => void | Promise<void>) => render(<ManualInvoices clients={[]} services={services} invoice={draft} variant="draftAdjustments" onSaved={onSaved} onGenerateSuccess={vi.fn()} />);
const fillCharge = async (description: string) => {
  await waitFor(() => expect(document.getElementById('add-line-item-button')).toBeTruthy());
  fireEvent.click(document.getElementById('add-line-item-button')!);
  let serviceSelect: HTMLSelectElement | null = null;
  await waitFor(() => {
    serviceSelect = document.querySelector('[id^="service-select-"]');
    expect(serviceSelect).toBeTruthy();
  });
  fireEvent.change(serviceSelect!, { target: { value: 'svc-1' } });
  fireEvent.change(document.getElementById('quantity-input')!, { target: { value: '3' } });
  fireEvent.change(document.getElementById('rate-input')!, { target: { value: '50' } });
  fireEvent.change(document.getElementById('description-input')!, { target: { value: description } });
};

describe('expanded invoice adjustment global save', () => {
  it('refreshes the parent summary and saves again after reselecting stale list data', async () => {
    let persisted: any[] = [];
    let serverInvoice: any = { ...invoice };
    let parentSummary: any = { ...invoice };
    mocks.snapshot.mockImplementation(async () => ({ ...serverInvoice, invoice_charges: [...serverInvoice.invoice_charges] }));
    mocks.update.mockImplementation(async (_id, changes, submission) => {
      expect(submission.expectedRevision).toBe(serverInvoice.draft_adjustment_revision);
      persisted = [...persisted, ...changes.newItems.map((item: any) => ({
        ...item, item_id: `persisted-${persisted.length}`, is_manual: true,
        total_price: item.quantity * item.rate, net_amount: item.quantity * item.rate, tax_amount: 0,
      }))];
      serverInvoice = {
        ...serverInvoice,
        draft_adjustment_revision: serverInvoice.draft_adjustment_revision + 1,
        subtotal: serverInvoice.subtotal + 15000,
        total_amount: serverInvoice.total_amount + 15000,
        invoice_charges: [...invoice.invoice_charges, ...persisted],
      };
      return serverInvoice;
    });

    const refreshParentSummary = async () => { parentSummary = { ...serverInvoice }; };
    const first = renderDraft(parentSummary, refreshParentSummary);
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(1));
    await fillCharge('First adjustment');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(parentSummary.draft_adjustment_revision).toBe(8));
    expect(parentSummary.total_amount).toBe(405000);
    expect(parentSummary.invoice_charges).toHaveLength(2);

    first.unmount(); // deselect after the first successful save
    // A delayed list render must also be safe: the coherent read supersedes
    // this stale projection even though the parent refresh already completed.
    const second = renderDraft(invoice, refreshParentSummary);
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(2));
    await fillCharge('Second adjustment');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls.map((call) => call[2].expectedRevision)).toEqual([7, 8]);
    expect(persisted).toHaveLength(2);
    second.unmount();
  });

  it('submits the latest expanded charge values directly through global Save Changes', async () => {
    let revision = 7;
    let persisted: any[] = [];
    mocks.update.mockImplementation(async (_invoiceId, changes) => {
      revision += 1;
      persisted = [...persisted, ...changes.newItems.map((item: any) => ({
        ...item, is_manual: true, total_price: item.quantity * item.rate,
        net_amount: item.quantity * item.rate, tax_amount: 0,
      }))];
      return { ...invoice, draft_adjustment_revision: revision, invoice_charges: [...invoice.invoice_charges, ...persisted] };
    });
    renderDraft();
    await fillCharge('Manual adjustment');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][1].newItems).toEqual([expect.objectContaining({ service_id: 'svc-1', quantity: 3, rate: 5000, description: 'Manual adjustment' })]);
    expect(mocks.update.mock.calls[0][2]).toEqual({ operationId: expect.any(String), expectedRevision: 7 });

    // The authoritative response is reloaded into the editor. A second save
    // updates the existing row and does not append a duplicate.
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1][1].newItems).toEqual([]);
    expect(mocks.update.mock.calls[1][1].updatedItems).toHaveLength(1);
    expect(persisted).toHaveLength(1);
  });

  it('preserves expanded inputs when persistence fails', async () => {
    mocks.update.mockResolvedValue({ success: false, code: 'unexpected_error', message: 'write failed' });
    renderDraft();
    await fillCharge('Keep me');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect((document.getElementById('description-input') as HTMLInputElement).value).toBe('Keep me');
    expect((document.getElementById('quantity-input') as HTMLInputElement).value).toBe('3');
  });

  it('keeps a draft and surfaces a genuine concurrent revision conflict without replay', async () => {
    mocks.update.mockResolvedValue({ success: false, code: 'STALE_ADJUSTMENT_REVISION', params: {}, message: 'Invoice changed while you were editing' });
    renderDraft();
    await fillCharge('Keep after concurrent change');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Invoice changed while you were editing')).toBeTruthy();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect((document.getElementById('description-input') as HTMLInputElement).value).toBe('Keep after concurrent change');
    expect(mocks.update.mock.calls[0][2].expectedRevision).toBe(7);
  });

  it('preserves edits and the operation identity for an explicit retry after reauthentication', async () => {
    const unauthenticated = JSON.parse(JSON.stringify({
      success: false,
      code: 'UNAUTHENTICATED',
      params: {},
      message: 'Authentication required',
      error: 'Authentication required',
    }));
    mocks.update.mockResolvedValueOnce(unauthenticated).mockResolvedValueOnce({
      ...invoice,
      draft_adjustment_revision: 8,
      invoice_charges: [...invoice.invoice_charges, {
        item_id: 'saved-1', invoice_id: 'invoice-1', service_id: 'svc-1', description: 'Unsaved charge',
        quantity: 3, unit_price: 5000, total_price: 15000, net_amount: 15000, tax_amount: 0,
        is_manual: true, is_discount: false, is_taxable: false,
      }],
    });
    renderDraft();
    await fillCharge('Unsaved charge');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText(/Your session expired before this save completed/)).toBeTruthy();
    expect((document.getElementById('description-input') as HTMLInputElement).value).toBe('Unsaved charge');
    expect((document.getElementById('quantity-input') as HTMLInputElement).value).toBe('3');

    const reauthenticate = screen.getByRole('link', { name: 'Sign in again' }) as HTMLAnchorElement;
    expect(reauthenticate.href).toContain('/auth/signin?callbackUrl=');
    expect(reauthenticate.target).toBe('_blank');
    const operationId = mocks.update.mock.calls[0][2].operationId;
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1][2]).toEqual({ operationId, expectedRevision: 7 });
    expect(screen.queryByText(/Your session expired before this save completed/)).toBeNull();
  });

  it('keeps invoice drafts and performs only an explicit read retry after line loading expires', async () => {
    const authError = { success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required', error: 'Authentication required' };
    mocks.lineItems.mockResolvedValueOnce(authError).mockResolvedValueOnce(invoice.invoice_charges);
    renderDraft();
    expect(await screen.findByText(/session expired while loading invoice details/i)).toBeTruthy();
    await fillCharge('Keep this after read retry');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.lineItems).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(mocks.lineItems).toHaveBeenCalledTimes(2));
    expect(mocks.update).not.toHaveBeenCalled();
    expect((document.getElementById('description-input') as HTMLInputElement).value).toBe('Keep this after read retry');
    expect(screen.queryByText(/session expired while loading invoice details/i)).toBeNull();
  });

  it('adopts the recovered revision when the initial snapshot auth read never established a baseline', async () => {
    const authError = { success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required', error: 'Authentication required' };
    mocks.snapshot
      .mockResolvedValueOnce(authError)
      .mockResolvedValueOnce({ ...invoice, draft_adjustment_revision: 8, subtotal: 405000, total_amount: 405000 });
    mocks.update.mockResolvedValue({ ...invoice, draft_adjustment_revision: 9, total_amount: 420000, invoice_charges: invoice.invoice_charges });
    renderDraft({ ...invoice, draft_adjustment_revision: 7 });
    expect(await screen.findByText(/session expired while loading invoice details/i)).toBeTruthy();
    await fillCharge('Keep edit through initial read recovery');

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(2));
    expect((document.getElementById('description-input') as HTMLInputElement).value).toBe('Keep edit through initial read recovery');
    expect(screen.queryByText(/session expired while loading invoice details/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][2].expectedRevision).toBe(8);
    expect(mocks.update.mock.calls[0][1].newItems).toEqual([
      expect.objectContaining({ description: 'Keep edit through initial read recovery' }),
    ]);
  });

  it.each(['expanded', 'collapsed'] as const)(
    'loads current persisted rows alongside %s additions after initial read recovery',
    async (draftState) => {
      const oldCharge = {
        item_id: 'existing-manual', invoice_id: 'invoice-1', service_id: 'svc-1',
        description: 'Old saved description', quantity: 1, unit_price: 1000,
        net_amount: 1000, total_price: 1000, tax_amount: 0,
        is_manual: true, is_discount: false, is_taxable: false,
      };
      const deletedCharge = { ...oldCharge, item_id: 'deleted-manual', description: 'Deleted elsewhere' };
      const currentCharge = { ...oldCharge, description: 'Changed by another operator', unit_price: 2500, net_amount: 2500, total_price: 2500 };
      const recovered = { ...invoice, draft_adjustment_revision: 8, invoice_charges: [...invoice.invoice_charges, currentCharge] };
      mocks.snapshot.mockResolvedValueOnce({ success: false, code: 'UNAUTHENTICATED' })
        .mockResolvedValue(recovered);
      mocks.update.mockResolvedValue({ ...recovered, draft_adjustment_revision: 9 });
      renderDraft({ ...invoice, invoice_charges: [...invoice.invoice_charges, oldCharge, deletedCharge] });
      expect(await screen.findByText(/session expired while loading invoice details/i)).toBeTruthy();
      expect(document.getElementById('item-existing-manual')).toBeNull();
      expect(document.getElementById('item-deleted-manual')).toBeNull();
      await fillCharge('Addition during recovery');
      if (draftState === 'collapsed') fireEvent.click(document.getElementById('collapse-line-item-button')!);
      fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
      await waitFor(() => expect(screen.queryByText(/session expired while loading invoice details/i)).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
      const [, changes, submission] = mocks.update.mock.calls[0];
      expect(submission.expectedRevision).toBe(8);
      expect(changes.updatedItems).toEqual([
        expect.objectContaining({ item_id: oldCharge.item_id, description: currentCharge.description, rate: 2500 }),
      ]);
      expect(changes.newItems).toEqual([
        expect.objectContaining({ description: 'Addition during recovery', quantity: 3, rate: 5000 }),
      ]);
      expect(changes.removedItemIds).toEqual([]);
    },
  );

  it('retains an established revision when recovery observes a concurrent change', async () => {
    mocks.snapshot.mockResolvedValueOnce(invoice).mockResolvedValue({ ...invoice, draft_adjustment_revision: 8 });
    mocks.locations.mockResolvedValueOnce({ success: false, code: 'UNAUTHENTICATED' }).mockResolvedValue([]);
    mocks.update.mockImplementation(async (_id, _changes, submission) => submission.expectedRevision === 7
      ? { success: false, code: 'STALE_ADJUSTMENT_REVISION', message: 'Concurrent invoice change' }
      : { ...invoice, draft_adjustment_revision: 9 });
    renderDraft();
    expect(await screen.findByText(/session expired while loading invoice details/i)).toBeTruthy();
    await fillCharge('Keep conflicting addition');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(screen.queryByText(/session expired while loading invoice details/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Concurrent invoice change')).toBeTruthy();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][2].expectedRevision).toBe(7);
    expect((document.getElementById('description-input') as HTMLInputElement).value).toBe('Keep conflicting addition');
  });

  it('keeps permission denial visible after an auth recovery read and preserves edits', async () => {
    mocks.lineItems
      .mockResolvedValueOnce({ success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required', error: 'Authentication required' })
      .mockResolvedValueOnce({ permissionError: 'Permission denied: billing read required' });
    renderDraft();
    expect(await screen.findByText(/session expired while loading invoice details/i)).toBeTruthy();
    await fillCharge('Keep edit after denied retry');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByText('Permission denied: billing read required')).toBeTruthy();
    expect(screen.queryByText(/session expired while loading invoice details/i)).toBeNull();
    expect((document.getElementById('description-input') as HTMLInputElement).value).toBe('Keep edit after denied retry');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ['location', () => mocks.locations.mockResolvedValueOnce({ success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required' })],
    ['billing profile', () => mocks.profiles.mockResolvedValueOnce({ success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required' })],
  ])('recovers from %s attribution expiry and keeps edits when retrying attribution reads', async (_kind, expireRead) => {
    expireRead();
    mocks.lineItems.mockResolvedValue(invoice.invoice_charges);
    renderDraft();
    expect(await screen.findByText(/session expired while loading invoice details/i)).toBeTruthy();
    await fillCharge('Keep attribution edit');
    expect(mocks.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(mocks.locations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.profiles).toHaveBeenCalledTimes(2));
    expect((document.getElementById('description-input') as HTMLInputElement).value).toBe('Keep attribution edit');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.queryByText(/session expired while loading invoice details/i)).toBeNull();
  });

  it.each(['detail-first', 'attribution-first'] as const)(
    'preserves collapsed additions, removals and save identity across repeated recovery (%s)',
    async (completionOrder) => {
      const expired = { success: false, code: 'UNAUTHENTICATED', params: {}, message: 'Authentication required' };
      const existingCharge = {
        item_id: 'recovery-remove', invoice_id: 'invoice-1', service_id: 'svc-1',
        description: 'Remove during recovery', quantity: 1, unit_price: 2500,
        total_price: 2500, net_amount: 2500, tax_amount: 0,
        is_manual: true, is_discount: false, is_taxable: false,
      };
      const persistedItems = [...invoice.invoice_charges, existingCharge];
      let resolveDetails!: (value: any) => void;
      let resolveLocations!: (value: any) => void;
      mocks.locations.mockResolvedValueOnce(expired)
        .mockImplementationOnce(() => new Promise(resolve => { resolveLocations = resolve; }))
        .mockResolvedValue([]);
      mocks.lineItems.mockResolvedValueOnce(persistedItems)
        .mockImplementationOnce(() => new Promise(resolve => { resolveDetails = resolve; }))
        .mockResolvedValue(persistedItems);
      mocks.update.mockResolvedValue(expired);
      renderDraft({ ...invoice, invoice_charges: persistedItems });
      expect(await screen.findByText(/session expired while loading invoice details/i)).toBeTruthy();
      await fillCharge('Collapsed attribution draft');
      fireEvent.click(document.getElementById('collapse-line-item-button')!);
      fireEvent.click(document.getElementById('item-recovery-remove')!);
      fireEvent.click(document.getElementById('remove-line-item-button')!);

      fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
      await waitFor(() => expect(mocks.locations).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(mocks.lineItems).toHaveBeenCalledTimes(2));
      if (completionOrder === 'attribution-first') {
        await act(async () => { resolveLocations(expired); });
        await act(async () => { resolveDetails(persistedItems); });
      } else {
        await act(async () => { resolveDetails(persistedItems); });
        await act(async () => { resolveLocations(expired); });
      }
      expect(screen.getByText(/session expired while loading invoice details/i)).toBeTruthy();
      expect(screen.getByText('Collapsed attribution draft')).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
      });
      expect(mocks.lineItems).toHaveBeenCalledTimes(3);
      expect(mocks.locations).toHaveBeenCalledTimes(3);
      expect(screen.queryByText(/session expired while loading invoice details/i)).toBeNull();
      expect(screen.getByText('Collapsed attribution draft')).toBeTruthy();
      expect(screen.queryByText('Remove during recovery')).toBeNull();
      expect(mocks.update).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      expect(await screen.findByText(/Your session expired before this save completed/)).toBeTruthy();
      expect(mocks.update.mock.calls[0][1].newItems).toEqual([
        expect.objectContaining({ description: 'Collapsed attribution draft', quantity: 3, rate: 5000 }),
      ]);
      expect(mocks.update.mock.calls[0][1].removedItemIds).toEqual(['recovery-remove']);
      fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
      await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
      expect(mocks.update.mock.calls[1]).toEqual(mocks.update.mock.calls[0]);
    },
  );

  it('keeps attribution permission denial visible and separate from session recovery', async () => {
    mocks.locations.mockResolvedValueOnce({ permissionError: 'Permission denied: client read required' });
    mocks.lineItems.mockResolvedValue(invoice.invoice_charges);
    renderDraft();
    expect(await screen.findByText('Permission denied: client read required')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('ignores a late detail response after selecting another invoice', async () => {
    let resolveOld!: (value: any) => void;
    const oldLine = { item_id: 'old-row', invoice_id: 'invoice-1', description: 'Old invoice row', service_id: 'svc-1', quantity: 1, unit_price: 100, is_manual: true, is_taxable: false };
    const newLine = { ...oldLine, item_id: 'new-row', invoice_id: 'invoice-2', description: 'New invoice row' };
    mocks.lineItems.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce([newLine] as any);
    const view = renderDraft({ ...invoice, invoice_charges: [oldLine] });
    await waitFor(() => expect(mocks.lineItems).toHaveBeenCalledTimes(1));
    view.rerender(<ManualInvoices clients={[]} services={services} invoice={{ ...invoice, invoice_id: 'invoice-2', invoice_charges: [newLine] }} variant="draftAdjustments" onGenerateSuccess={vi.fn()} />);
    await waitFor(() => expect(mocks.lineItems).toHaveBeenCalledTimes(2));
    resolveOld([oldLine]);
    await waitFor(() => expect(screen.getByText('New invoice row')).toBeTruthy());
    expect(screen.queryByText('Old invoice row')).toBeNull();
  });

  it('keeps collapsed pending values and removals through auth rejection and explicit retry', async () => {
    const existingCharge = {
      item_id: 'manual-to-remove', invoice_id: 'invoice-1', service_id: 'svc-1',
      description: 'Existing manual row', quantity: 1, unit_price: 2500,
      total_price: 2500, net_amount: 2500, tax_amount: 0,
      is_manual: true, is_discount: false, is_taxable: false,
    };
    mocks.lineItems.mockResolvedValueOnce([existingCharge] as any);
    mocks.update.mockResolvedValueOnce(JSON.parse(JSON.stringify({
      success: false, code: 'UNAUTHENTICATED', params: {},
      message: 'Authentication required', error: 'Authentication required',
    }))).mockResolvedValueOnce({
      ...invoice,
      draft_adjustment_revision: 8,
      invoice_charges: [...invoice.invoice_charges, existingCharge],
    });
    renderDraft({ ...invoice, invoice_charges: [...invoice.invoice_charges, existingCharge] });
    await fillCharge('Collapsed pending row');
    fireEvent.click(document.getElementById('collapse-line-item-button')!);

    fireEvent.click(document.getElementById('item-manual-to-remove')!);
    fireEvent.click(document.getElementById('remove-line-item-button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText(/Your session expired before this save completed/)).toBeTruthy();
    expect(screen.getByText('Collapsed pending row')).toBeTruthy();
    expect(screen.queryByText('Existing manual row')).toBeNull();
    expect(mocks.update.mock.calls[0][1].newItems).toEqual([
      expect.objectContaining({ description: 'Collapsed pending row', quantity: 3, rate: 5000 }),
    ]);
    expect(mocks.update.mock.calls[0][1].removedItemIds).toEqual(['manual-to-remove']);

    const operationId = mocks.update.mock.calls[0][2].operationId;
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1][1]).toEqual(mocks.update.mock.calls[0][1]);
    expect(mocks.update.mock.calls[1][1].removedItemIds).toEqual(['manual-to-remove']);
    expect(mocks.update.mock.calls[1][2]).toEqual({ operationId, expectedRevision: 7 });
  });

  it('reports a post-save callback failure as saved instead of an auth rejection', async () => {
    const onSaved = vi.fn(async () => { throw Object.assign(new Error('refresh failed'), { name: 'AuthenticationError' }); });
    mocks.update.mockResolvedValue({
      ...invoice,
      draft_adjustment_revision: 8,
      invoice_charges: [...invoice.invoice_charges, {
        item_id: 'saved-1', invoice_id: 'invoice-1', service_id: 'svc-1', description: 'Saved charge',
        quantity: 3, unit_price: 5000, total_price: 15000, net_amount: 15000, tax_amount: 0,
        is_manual: true, is_discount: false, is_taxable: false,
      }],
    });
    renderDraft(invoice, onSaved);
    await fillCharge('Saved charge');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText(/Your changes were saved, but the invoice page could not finish refreshing/)).toBeTruthy();
    expect(screen.queryByText(/Your session expired/)).toBeNull();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('reports an authoritative line refresh failure as saved after the mutation commits', async () => {
    mocks.lineItems.mockResolvedValueOnce([]).mockResolvedValueOnce({ actionError: 'refresh denied' } as any);
    mocks.update.mockResolvedValue({ ...invoice, draft_adjustment_revision: 8, invoice_charges: undefined });
    renderDraft();
    await fillCharge('Saved before refresh failed');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(await screen.findByText(/Your changes were saved, but the invoice page could not finish refreshing/)).toBeTruthy();
    expect(screen.queryByText(/Your session expired/)).toBeNull();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.lineItems).toHaveBeenCalledTimes(2);
  });

  it('submits edits to an existing charge while its row remains expanded', async () => {
    const existingCharge = { item_id: 'manual-1', invoice_id: 'invoice-1', service_id: 'svc-1', description: 'Old charge', quantity: 1, unit_price: 2500, total_price: 2500, net_amount: 2500, tax_amount: 0, is_manual: true, is_discount: false, is_taxable: false };
    const draft = { ...invoice, invoice_charges: [...invoice.invoice_charges, existingCharge] };
    mocks.lineItems.mockResolvedValueOnce([existingCharge] as any);
    mocks.update.mockResolvedValue({ success: false, code: 'unexpected_error', message: 'write failed' });
    renderDraft(draft);
    await waitFor(() => expect(document.getElementById('item-manual-1')).toBeTruthy());
    fireEvent.click(document.getElementById('item-manual-1')!);
    fireEvent.change(document.getElementById('quantity-input')!, { target: { value: '3' } });
    fireEvent.change(document.getElementById('rate-input')!, { target: { value: '50' } });
    fireEvent.change(document.getElementById('description-input')!, { target: { value: 'Edited charge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][1].updatedItems).toEqual([expect.objectContaining({ item_id: 'manual-1', quantity: 3, rate: 5000, description: 'Edited charge' })]);
    expect((document.getElementById('description-input') as HTMLInputElement).value).toBe('Edited charge');
  });

  it('keeps edited values and parent removal state when editing then removing an existing row', async () => {
    const existingCharge = { item_id: 'remove-1', invoice_id: 'invoice-1', service_id: 'svc-1', description: 'Before', quantity: 1, unit_price: 2500, total_price: 2500, net_amount: 2500, tax_amount: 0, is_manual: true, is_discount: false, is_taxable: false };
    mocks.lineItems.mockResolvedValueOnce([existingCharge] as any);
    mocks.update.mockResolvedValue({ ...invoice, draft_adjustment_revision: 8, invoice_charges: invoice.invoice_charges });
    renderDraft({ ...invoice, invoice_charges: [...invoice.invoice_charges, existingCharge] });
    await waitFor(() => expect(document.getElementById('item-remove-1')).toBeTruthy());
    fireEvent.click(document.getElementById('item-remove-1')!);
    fireEvent.change(document.getElementById('description-input')!, { target: { value: 'Edited before removal' } });
    fireEvent.change(document.getElementById('rate-input')!, { target: { value: '40' } });
    fireEvent.click(document.getElementById('remove-line-item-button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][1].removedItemIds).toEqual(['remove-1']);
    expect(mocks.update.mock.calls[0][1].updatedItems).toEqual([]);
  });

  it('restores an edited row and saves its values as an update', async () => {
    const existingCharge = { item_id: 'restore-1', invoice_id: 'invoice-1', service_id: 'svc-1', description: 'Before', quantity: 1, unit_price: 2500, total_price: 2500, net_amount: 2500, tax_amount: 0, is_manual: true, is_discount: false, is_taxable: false };
    mocks.lineItems.mockResolvedValueOnce([existingCharge] as any);
    mocks.update.mockResolvedValue({ success: false, code: 'unexpected_error', message: 'write failed' });
    renderDraft({ ...invoice, invoice_charges: [...invoice.invoice_charges, existingCharge] });
    await waitFor(() => expect(document.getElementById('item-restore-1')).toBeTruthy());
    fireEvent.click(document.getElementById('item-restore-1')!);
    fireEvent.change(document.getElementById('description-input')!, { target: { value: 'Edited and restored' } });
    fireEvent.change(document.getElementById('rate-input')!, { target: { value: '45' } });
    fireEvent.click(document.getElementById('remove-line-item-button')!);
    await waitFor(() => expect(document.getElementById('restore-line-item-button')).toBeTruthy());
    fireEvent.click(document.getElementById('restore-line-item-button')!);
    expect((document.getElementById('description-input') as HTMLInputElement).value).toBe('Edited and restored');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][1].removedItemIds).toEqual([]);
    expect(mocks.update.mock.calls[0][1].updatedItems).toEqual([expect.objectContaining({ item_id: 'restore-1', description: 'Edited and restored', rate: 4500 })]);
  });

  it('blocks invalid quantity, explains the correction, and retains the expanded input', async () => {
    renderDraft();
    await fillCharge('Quantity needs correction');
    fireEvent.change(document.getElementById('quantity-input')!, { target: { value: '0' } });
    fireEvent.submit(document.querySelector('form')!);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(await screen.findByText('Quantity must be greater than zero.')).toBeTruthy();
    expect((document.getElementById('quantity-input') as HTMLInputElement).value).toBe('0');
  });

  it('preserves the later pending row when an earlier new row is removed and indices shift', async () => {
    renderDraft();
    await waitFor(() => expect(document.getElementById('add-line-item-button')).toBeTruthy());
    fireEvent.click(document.getElementById('add-line-item-button')!);
    let selects = document.querySelectorAll('[id^="service-select-"]');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'svc-1' } });
    fireEvent.change(document.querySelectorAll('#quantity-input')[0], { target: { value: '2' } });
    fireEvent.change(document.querySelectorAll('#rate-input')[0], { target: { value: '10' } });
    fireEvent.change(document.querySelectorAll('#description-input')[0], { target: { value: 'Earlier row' } });
    fireEvent.click(document.getElementById('collapse-line-item-button')!);

    fireEvent.click(document.getElementById('add-line-item-button')!);
    selects = document.querySelectorAll('[id^="service-select-"]');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'svc-1' } });
    fireEvent.change(document.querySelectorAll('#quantity-input')[0], { target: { value: '3' } });
    fireEvent.change(document.querySelectorAll('#rate-input')[0], { target: { value: '20' } });
    fireEvent.change(document.querySelectorAll('#description-input')[0], { target: { value: 'Later row survives' } });

    const earlierRow = screen.getByText('Earlier row').closest('[id^="item-"]') as HTMLElement;
    fireEvent.click(earlierRow);
    fireEvent.click(earlierRow.querySelector('#remove-line-item-button')!);
    mocks.update.mockResolvedValue({ success: false, code: 'unexpected_error', message: 'write failed' });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][1].newItems).toEqual([expect.objectContaining({ description: 'Later row survives', quantity: 3, rate: 2000 })]);
  });

  it('submits a new negative-rate charge credit from its expanded row', async () => {
    let persistedCredit: any;
    let revision = 7;
    mocks.update.mockImplementation(async (_invoiceId, changes) => {
      revision += 1;
      if (changes.newItems.length) {
        const item = changes.newItems[0];
        persistedCredit = {
          ...item, unit_price: item.rate, is_manual: true, is_discount: true, is_manual_credit: true,
          discount_type: 'fixed', total_price: item.quantity * item.rate,
          net_amount: item.quantity * item.rate, tax_amount: 0,
        };
      }
      return { ...invoice, draft_adjustment_revision: revision, invoice_charges: [...invoice.invoice_charges, ...(persistedCredit ? [persistedCredit] : [])] };
    });
    renderDraft();
    await waitFor(() => expect(document.getElementById('add-line-item-button')).toBeTruthy());
    fireEvent.click(document.getElementById('add-line-item-button')!);
    const select = await waitFor(() => {
      const element = document.querySelector('[id^="service-select-"]') as HTMLSelectElement | null;
      expect(element).toBeTruthy();
      return element!;
    });
    fireEvent.change(select, { target: { value: 'svc-1' } });
    fireEvent.change(document.getElementById('quantity-input')!, { target: { value: '3' } });
    fireEvent.change(document.getElementById('rate-input')!, { target: { value: '-50' } });
    fireEvent.change(document.getElementById('description-input')!, { target: { value: 'New quantity credit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][1].newItems).toEqual([expect.objectContaining({ description: 'New quantity credit', quantity: 3, rate: -5000, is_discount: false })]);
    expect(persistedCredit).toMatchObject({ is_manual_credit: true, is_discount: true, rate: -5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1][1].newItems).toEqual([]);
    expect(mocks.update.mock.calls[1][1].updatedItems).toEqual([expect.objectContaining({ item_id: persistedCredit.item_id, quantity: 3, rate: -5000 })]);
  });

  it.each([
    ['fixed', '25.50', { rate: -2550, discount_type: 'fixed' }],
    ['percentage', '10', { rate: 0, discount_type: 'percentage', discount_percentage: 10 }],
  ] as const)('submits a new expanded %s discount without row Add', async (discountType, amount, expected) => {
    mocks.update.mockResolvedValue({ success: false, code: 'unexpected_error', message: 'write failed' });
    renderDraft();
    await waitFor(() => expect(document.getElementById('add-discount-button')).toBeTruthy());
    fireEvent.click(document.getElementById('add-discount-button')!);
    fireEvent.change(document.getElementById('discount-type-select')!, { target: { value: discountType } });
    fireEvent.change(document.getElementById('discount-value-input')!, { target: { value: amount } });
    fireEvent.change(document.getElementById('discount-description-input')!, { target: { value: `${discountType} discount` } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][1].newItems).toEqual([expect.objectContaining({ is_discount: true, description: `${discountType} discount`, ...expected })]);
  });

  it.each([
    ['fixed', -2550, undefined, '30.00', { rate: -3000, discount_type: 'fixed' }],
    ['percentage', 0, 10, '15', { discount_type: 'percentage', discount_percentage: 15 }],
  ] as const)('submits an edited existing %s discount while expanded', async (discountType, rate, percentage, amount, expected) => {
    const discount = { item_id: `discount-${discountType}`, invoice_id: 'invoice-1', description: 'Existing discount', quantity: 1, unit_price: rate, total_price: rate, net_amount: rate, tax_amount: 0, is_manual: true, is_discount: true, discount_type: discountType, discount_percentage: percentage, is_taxable: false };
    mocks.lineItems.mockResolvedValueOnce([discount] as any);
    mocks.update.mockResolvedValue({ success: false, code: 'unexpected_error', message: 'write failed' });
    renderDraft({ ...invoice, invoice_charges: [...invoice.invoice_charges, discount] });
    await waitFor(() => expect(document.getElementById(`item-${discount.item_id}`)).toBeTruthy());
    fireEvent.click(document.getElementById(`item-${discount.item_id}`)!);
    fireEvent.change(document.getElementById('discount-value-input')!, { target: { value: amount } });
    fireEvent.change(document.getElementById('discount-description-input')!, { target: { value: 'Updated discount' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][1].updatedItems).toEqual([expect.objectContaining({ item_id: discount.item_id, is_discount: true, description: 'Updated discount', ...expected })]);
  });

  it('submits an edited quantity-derived credit while expanded', async () => {
    const credit = { item_id: 'credit-1', invoice_id: 'invoice-1', service_id: 'svc-1', description: 'Quantity credit', quantity: 3, unit_price: -10000, total_price: -30000, net_amount: -30000, tax_amount: 0, is_manual: true, is_discount: true, is_manual_credit: true, discount_type: 'fixed', is_taxable: false };
    mocks.lineItems.mockResolvedValueOnce([credit] as any);
    mocks.update.mockResolvedValue({ success: false, code: 'unexpected_error', message: 'write failed' });
    renderDraft({ ...invoice, invoice_charges: [...invoice.invoice_charges, credit] });
    await waitFor(() => expect(document.getElementById('item-credit-1')).toBeTruthy());
    fireEvent.click(document.getElementById('item-credit-1')!);
    fireEvent.change(document.getElementById('quantity-input')!, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][1].updatedItems).toEqual([expect.objectContaining({ item_id: 'credit-1', quantity: 5, rate: -10000 })]);
  });
});
