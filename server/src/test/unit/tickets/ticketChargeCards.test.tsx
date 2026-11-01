/* @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const state = vi.hoisted(() => ({
  readOnly: false,
  invoice: { list: vi.fn(), invoices: vi.fn(), generate: vi.fn() },
  fixedFees: {
    listTicketFixedFeeServices: vi.fn(),
    addTicketFixedFeeService: vi.fn(),
    updateTicketFixedFeeService: vi.fn(),
    deleteTicketFixedFeeService: vi.fn(),
  },
  materials: {
    getTicketCatalogCategories: vi.fn(),
    searchServiceCatalogForPicker: vi.fn(), getServicePrices: vi.fn(),
    listTicketMaterials: vi.fn(), addTicketMaterial: vi.fn(), deleteTicketMaterial: vi.fn(),
    updateTicketMaterial: vi.fn(), listAvailableStockUnitsForMaterial: vi.fn(), getProductAvailability: vi.fn(),
  },
}));
vi.mock('@alga-psa/tickets/components/ticket/TicketDataSourceContext', () => ({
  useTicketDataSource: () => state,
  useTicketScreenReadOnly: () => state.readOnly,
}));
const t = (key: string) => key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t }),
  useFormatters: () => ({ formatCurrency: (value: number, currency: string) => `${currency} ${value}` }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/components/ActionSurface', () => ({
  ActionTrigger: ({ id, onClick, label, disabled }: { id: string; onClick: () => void; label: string; disabled: boolean }) =>
    <button id={id} onClick={onClick} disabled={disabled}>{label}</button>,
}));
vi.mock('@alga-psa/billing/actions/ticketInvoiceActions', () => ({
  getTicketBillableItems: state.invoice.list,
  getTicketInvoices: state.invoice.invoices,
  generateTicketInvoice: state.invoice.generate,
}));
vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({ money: (value: number, currency: string) => `${currency} ${value / 100}`, currencyCode: 'USD' }),
}));
vi.mock('@alga-psa/ui/components', () => ({
  ContentCard: ({ children, title, addButton }: {
    children: React.ReactNode; title: string; addButton?: { id: string; label: string; onClick: () => void };
  }) => <section><h2>{title}</h2>{addButton && <button id={addButton.id} onClick={addButton.onClick}>{addButton.label}</button>}{children}</section>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string; size?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, disabled }: {
    id: string; value: string; onValueChange: (value: string) => void; disabled?: boolean;
    options: { value: string; label: string }[];
  }) => <select id={id} value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
    <option value="" />{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, footer, title, isOpen = true }: { children: React.ReactNode; footer: React.ReactNode; title: string; isOpen?: boolean }) =>
    isOpen ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: ({ id }: { id: string }) => ({ automationIdProps: { id } }),
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isActionMessageError: (value: unknown) => Boolean(value && typeof value === 'object' && 'actionError' in value),
  isActionPermissionError: (value: unknown) => Boolean(value && typeof value === 'object' && 'permissionError' in value),
  getErrorMessage: (value: { actionError?: string }) => value.actionError,
  handleError: vi.fn(),
}));

import TicketFixedFeeServicesCard from '@alga-psa/tickets/components/ticket/TicketFixedFeeServicesCard';
import TicketChargeEditDialog from '@alga-psa/tickets/components/ticket/TicketChargeEditDialog';
import TicketMaterialsCard from '@alga-psa/tickets/components/ticket/TicketMaterialsCard';
import QuickInvoiceTicketDialog from '@alga-psa/billing/components/ticket/QuickInvoiceTicketDialog';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.readOnly = false;
  state.fixedFees.listTicketFixedFeeServices.mockResolvedValue([]);
  state.fixedFees.addTicketFixedFeeService.mockResolvedValue({ entry_id: 'fee-1' });
  state.fixedFees.updateTicketFixedFeeService.mockResolvedValue(undefined);
  state.materials.searchServiceCatalogForPicker.mockResolvedValue({
    items: [{ service_id: 'service-1', service_name: 'Onsite setup', free_total: 99, track_stock: true }],
    totalCount: 1,
  });
  state.materials.getServicePrices.mockResolvedValue([{ currency_code: 'USD', rate: 2500 }]);
  state.materials.listTicketMaterials.mockResolvedValue([]);
  state.materials.getTicketCatalogCategories.mockResolvedValue([
    { category_id: 'category-1', category_name: 'Software' },
    { category_id: 'category-2', category_name: 'Support' },
  ]);
  state.materials.updateTicketMaterial.mockResolvedValue(undefined);
  // cmdk scrolls the active option into view; jsdom does not implement it.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

describe('ticket fixed-fee service card', () => {
  it('filters Services inside the dropdown, combining category and text and clearing to all categories', async () => {
    render(<TicketFixedFeeServicesCard ticketId="ticket-1" />);
    expect(state.materials.getTicketCatalogCategories).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'fixedFeeServices.add' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'fixedFeeServices.service' }));
    const filter = await screen.findByLabelText('catalogFilter.category');
    await waitFor(() => expect(filter).not.toBeDisabled());
    expect(state.materials.getTicketCatalogCategories).toHaveBeenCalledWith({ item_kinds: ['service'], billing_methods: ['fixed'] });
    fireEvent.change(filter, { target: { value: 'category-1' } });
    fireEvent.change(screen.getByPlaceholderText('form.searchPlaceholder'), { target: { value: 'license' } });
    await waitFor(() => expect(state.materials.searchServiceCatalogForPicker).toHaveBeenLastCalledWith({
      search: 'license', page: 1, limit: 10, item_kinds: ['service'], billing_methods: ['fixed'], is_active: true, category_id: 'category-1',
    }));
    fireEvent.change(filter, { target: { value: 'all' } });
    await waitFor(() => expect(state.materials.searchServiceCatalogForPicker).toHaveBeenLastCalledWith({
      search: 'license', page: 1, limit: 10, item_kinds: ['service'], billing_methods: ['fixed'], is_active: true,
    }));
  });

  it('surfaces category failures and allows retry', async () => {
    state.materials.getTicketCatalogCategories.mockRejectedValueOnce(new Error('Unavailable'));
    render(<TicketFixedFeeServicesCard ticketId="ticket-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'fixedFeeServices.add' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'fixedFeeServices.service' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('catalogFilter.loadError');
    fireEvent.click(screen.getByRole('button', { name: 'catalogFilter.retry' }));
    await waitFor(() => expect(screen.getByLabelText('catalogFilter.category')).not.toBeDisabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('uses the same columns, badges, inline actions and per-currency totals as materials', async () => {
    state.fixedFees.listTicketFixedFeeServices.mockResolvedValue([
      { entry_id: 'fee-1', service_name: 'Software', quantity: 2, rate: 2500, currency_code: 'USD', is_billed: false },
      { entry_id: 'fee-2', service_name: 'Setup', quantity: 1, rate: 1000, currency_code: 'EUR', is_billed: false },
      { entry_id: 'fee-3', service_name: 'Billed setup', quantity: 1, rate: 9000, currency_code: 'USD', is_billed: true },
    ]);
    render(<TicketFixedFeeServicesCard ticketId="ticket-1" />);
    const row = await screen.findByRole('row', { name: /Software/ });
    const table = screen.getByRole('table');
    for (const label of ['materials.qty', 'materials.rate', 'materials.total', 'materials.status']) {
      expect(within(table).getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
    expect(within(row).getByText('materials.pending')).toBeInTheDocument();
    const edit = within(row).getByRole('button', { name: 'chargeEdit.edit' });
    const remove = within(row).getByRole('button', { name: 'fixedFeeServices.remove' });
    expect(edit.parentElement).toBe(remove.parentElement);
    expect(edit).toHaveClass('h-8', 'w-8', 'p-0');
    expect(remove).toHaveClass('h-8', 'w-8', 'p-0');
    expect(screen.getAllByText('USD 50')).toHaveLength(2);
    expect(screen.getAllByText('EUR 10')).toHaveLength(3);
    const billedRow = screen.getByRole('row', { name: /Billed setup/ });
    expect(within(billedRow).queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses the real async picker with fixed-fee search filters, without stock badges', async () => {
    render(<TicketFixedFeeServicesCard ticketId="ticket-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'fixedFeeServices.add' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'fixedFeeServices.service' }));
    fireEvent.change(await screen.findByPlaceholderText('form.searchPlaceholder'), { target: { value: 'setup' } });
    expect(await screen.findByText('Onsite setup')).toBeInTheDocument();
    await waitFor(() => expect(state.materials.searchServiceCatalogForPicker).toHaveBeenLastCalledWith({
      search: 'setup', page: 1, limit: 10, item_kinds: ['service'], billing_methods: ['fixed'], is_active: true,
    }));
    expect(screen.queryByText(/99/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Onsite setup'));
    await waitFor(() => expect(screen.getByLabelText('fixedFeeServices.currency')).toHaveValue('USD'));
    fireEvent.click(screen.getByRole('button', { name: 'fixedFeeServices.increaseQuantity' }));
    fireEvent.change(screen.getByLabelText('fixedFeeServices.description'), { target: { value: 'Custom setup' } });
    const buttons = screen.getAllByRole('button', { name: 'fixedFeeServices.add' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(state.fixedFees.addTicketFixedFeeService).toHaveBeenCalledWith({
      ticket_id: 'ticket-1', service_id: 'service-1', quantity: 2, currency_code: 'USD', description: 'Custom setup',
    }));
  });

  it('shows edit only for unbilled entries and saves through the datasource', async () => {
    state.fixedFees.listTicketFixedFeeServices.mockResolvedValue([
      { entry_id: 'fee-1', service_name: 'Setup', quantity: 2, rate: 2500, currency_code: 'USD', description: 'Initial', is_billed: false },
      { entry_id: 'fee-2', service_name: 'Billed setup', quantity: 1, rate: 2500, currency_code: 'USD', is_billed: true },
    ]);
    render(<TicketFixedFeeServicesCard ticketId="ticket-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'chargeEdit.edit' }));
    fireEvent.change(screen.getByLabelText('fixedFeeServices.quantity'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('fixedFeeServices.description'), { target: { value: 'Revised' } });
    fireEvent.click(screen.getByRole('button', { name: 'chargeEdit.save' }));
    await waitFor(() => expect(state.fixedFees.updateTicketFixedFeeService).toHaveBeenCalledWith('fee-1', { quantity: 3, description: 'Revised' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('lists entries but hides all mutation controls on read-only sources', async () => {
    state.readOnly = true;
    state.fixedFees.listTicketFixedFeeServices.mockResolvedValue([
      { entry_id: 'fee-1', service_name: 'Setup', quantity: 2, rate: 2500, currency_code: 'USD', is_billed: false },
    ]);
    render(<TicketFixedFeeServicesCard ticketId="ticket-1" />);
    expect(await screen.findByText('Setup')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('clears an open editor when switching tickets', async () => {
    state.fixedFees.listTicketFixedFeeServices.mockResolvedValue([
      { entry_id: 'fee-1', service_name: 'Setup', quantity: 2, rate: 2500, currency_code: 'USD', is_billed: false },
    ]);
    const { rerender } = render(<TicketFixedFeeServicesCard ticketId="ticket-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'chargeEdit.edit' }));
    state.fixedFees.listTicketFixedFeeServices.mockResolvedValue([]);
    rerender(<TicketFixedFeeServicesCard ticketId="ticket-2" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.fixedFees.updateTicketFixedFeeService).not.toHaveBeenCalled();
  });
});

describe('shared fixed-fee/material edit dialog', () => {
  it('keeps entered values and displays returned errors without closing', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue({ actionError: 'The entry was already billed' });
    render(<TicketChargeEditDialog id="charge-edit" quantity={2} description="Initial" onClose={onClose} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'fixedFeeServices.increaseQuantity' }));
    fireEvent.click(screen.getByRole('button', { name: 'chargeEdit.save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The entry was already billed');
    expect(screen.getByLabelText('fixedFeeServices.quantity')).toHaveValue(3);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rejects fractional and zero quantities before submitting', async () => {
    const onSave = vi.fn();
    render(<TicketChargeEditDialog id="charge-edit" quantity={1} description="" onClose={vi.fn()} onSave={onSave} />);
    for (const value of ['0', '1.5', '2147483648']) {
      fireEvent.change(screen.getByLabelText('fixedFeeServices.quantity'), { target: { value } });
      expect(screen.getByRole('button', { name: 'chargeEdit.save' })).toBeDisabled();
    }
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('ticket material editing controls', () => {
  it('filters Materials by catalog category while preserving the product restriction', async () => {
    render(<TicketMaterialsCard ticketId="ticket-1" clientId="client-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'materials.addMaterial' }));
    fireEvent.click(screen.getByRole('combobox'));
    const filter = await screen.findByLabelText('catalogFilter.category');
    await waitFor(() => expect(filter).not.toBeDisabled());
    expect(state.materials.getTicketCatalogCategories).toHaveBeenCalledWith({ item_kinds: ['product'] });
    fireEvent.change(filter, { target: { value: 'category-2' } });
    await waitFor(() => expect(state.materials.searchServiceCatalogForPicker).toHaveBeenLastCalledWith({
      search: '', page: 1, limit: 10, item_kinds: ['product'], is_active: true, category_id: 'category-2',
    }));
  });
  it('keeps material row actions aligned in one shared action group', async () => {
    state.materials.listTicketMaterials.mockResolvedValue([
      { ticket_material_id: 'material-1', service_name: 'Long product name', sku: 'SKU-1', quantity: 2, rate: 2500, currency_code: 'USD', is_billed: false },
    ]);
    render(<TicketMaterialsCard ticketId="ticket-1" clientId="client-1" />);
    const row = await screen.findByRole('row', { name: /Long product name \(SKU-1\)/ });
    const edit = within(row).getByRole('button', { name: 'chargeEdit.edit' });
    const remove = within(row).getByRole('button', { name: 'common:actions.remove' });
    expect(edit.parentElement).toBe(remove.parentElement);
    expect(edit.parentElement).toHaveClass('flex', 'items-center', 'gap-1');
    expect(edit).toHaveClass('h-8', 'w-8', 'p-0');
    expect(remove).toHaveClass('h-8', 'w-8', 'p-0');
    expect(edit.id).not.toBe(remove.id);
  });

  it('edits unbilled material quantity/description through the shared dialog and datasource', async () => {
    state.materials.listTicketMaterials.mockResolvedValue([
      { ticket_material_id: 'material-1', service_name: 'Widget', quantity: 2, rate: 2500, currency_code: 'USD', description: 'Initial', is_billed: false },
      { ticket_material_id: 'material-2', service_name: 'Billed widget', quantity: 1, rate: 2500, currency_code: 'USD', is_billed: true },
    ]);
    render(<TicketMaterialsCard ticketId="ticket-1" clientId="client-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'chargeEdit.edit' }));
    fireEvent.change(screen.getByLabelText('fixedFeeServices.quantity'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('fixedFeeServices.description'), { target: { value: 'Revised widget' } });
    fireEvent.click(screen.getByRole('button', { name: 'chargeEdit.save' }));
    await waitFor(() => expect(state.materials.updateTicketMaterial).toHaveBeenCalledWith(
      'material-1', { quantity: 3, description: 'Revised widget' },
    ));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('quick invoice fixed-fee selection', () => {
  it('includes fixed fees in selection totals and submits selected fee ids with other charge kinds', async () => {
    state.invoice.list.mockResolvedValue({
      ticketId: 'ticket-1', clientId: 'client-1', currencyCode: 'USD',
      timeItems: [],
      materialItems: [{ id: 'material-1', description: 'Widget', quantity: 1, rate: 1000, amount: 1000 }],
      fixedFeeItems: [{ id: 'fee-1', serviceName: 'Setup', quantity: 2, rate: 2500, amount: 5000 }],
      excludedFixedFeeCount: 1, excludedMaterialCount: 0,
    });
    state.invoice.invoices.mockResolvedValue([]);
    state.invoice.generate.mockResolvedValue({
      success: true, invoice: { invoice_id: 'invoice-1', invoice_number: 'INV-1', total_amount: 6000, currencyCode: 'USD', status: 'draft' },
    });
    render(<QuickInvoiceTicketDialog ticket={{ ticket_id: 'ticket-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'quickInvoice.action' }));
    expect(await screen.findByText('quickInvoice.fixedFeeServices')).toBeInTheDocument();
    expect(screen.getByText('quickInvoice.excludedFixedFees')).toBeInTheDocument();
    expect(screen.getByText('USD 60')).toBeInTheDocument();
    const feeCheckbox = document.getElementById('ticket-details-fixed-fee-0-checkbox');
    expect(feeCheckbox).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'quickInvoice.create' }));
    await waitFor(() => expect(state.invoice.generate).toHaveBeenCalledWith({
      ticketId: 'ticket-1', timeEntryIds: [], materialIds: ['material-1'], fixedFeeIds: ['fee-1'],
    }));
    expect(await screen.findByRole('button', { name: /quickInvoice.viewInvoice/ })).toBeInTheDocument();
  });
});
