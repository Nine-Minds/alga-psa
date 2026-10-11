// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn(), warnings: vi.fn(async () => []), lineItems: vi.fn(async () => []) }));
vi.mock('../../actions/invoiceExportWarnings', () => ({ getInvoiceAdjustmentExportWarnings: mocks.warnings }));
vi.mock('@alga-psa/billing/actions/manualInvoiceActions', () => ({ generateManualInvoice: vi.fn(), getClientBillingEmailStatus: vi.fn(async () => ({ hasBillingEmail: true })) }));
vi.mock('@alga-psa/billing/actions/salesOrderInvoicingActions', () => ({ generateInvoiceForSalesOrder: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ updateInvoiceManualItems: mocks.update }));
vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({ getInvoiceLineItems: mocks.lineItems }));
vi.mock('@alga-psa/billing/actions/billingClientLocationActions', () => ({ getActiveClientLocationsForBilling: vi.fn(async () => []) }));
vi.mock('@alga-psa/billing/actions/taxRateActions', () => ({ getTaxRates: vi.fn(async () => []) }));
vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({ getClientBillingProfilesForBilling: vi.fn(async () => []) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@alga-psa/ui/context', () => ({ useQuickAddClient: () => ({ renderQuickAddClient: () => null }) }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ __esModule: true, default: ({ id, options = [], value, onValueChange }: any) => <select id={id} value={value ?? ''} onChange={(e) => onValueChange(e.target.value)}><option value="">Select</option>{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({ default: () => null }));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (props: any) => <input {...props} /> }));
vi.mock('@alga-psa/ui/components/Checkbox', () => ({ Checkbox: (props: any) => <input type="checkbox" {...props} /> }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({ Alert: ({ children }: any) => <div role="alert">{children}</div>, AlertDescription: ({ children }: any) => <div>{children}</div> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_k: string, o?: Record<string, unknown>) => (o?.defaultValue as string | undefined) ?? _k }), useFormatters: () => ({ formatCurrency: (v: number) => `$${v.toFixed(2)}` }) }));

import ManualInvoices from './ManualInvoices';
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const invoice: any = {
  invoice_id: 'invoice-1', client_id: 'client-1', invoice_number: 'INV-1', currencyCode: 'USD', is_manual: false,
  draft_adjustment_revision: 7, total_amount: 390000,
  invoice_charges: [{ item_id: 'generated-1', invoice_id: 'invoice-1', service_id: 'svc-1', description: 'Recurring', quantity: 1, unit_price: 390000, total_price: 390000, net_amount: 390000, tax_amount: 0, is_manual: false, is_discount: false, is_taxable: false }],
};
const services: any[] = [{ service_id: 'svc-1', service_name: 'Support', item_kind: 'service', is_active: true, default_rate: 5000, prices: [{ currency_code: 'USD', rate: 5000 }] }];
const renderDraft = (draft = invoice) => render(<ManualInvoices clients={[]} services={services} invoice={draft} variant="draftAdjustments" onGenerateSuccess={vi.fn()} />);
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
