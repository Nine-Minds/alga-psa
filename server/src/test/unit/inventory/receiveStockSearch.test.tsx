// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockOverview } from '@alga-psa/inventory/components/StockOverview';

const mocks = vi.hoisted(() => ({ locations: vi.fn(), receive: vi.fn(), products: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@alga-psa/inventory/actions', () => ({
  listStockLocations: mocks.locations,
  receiveStockManual: mocks.receive,
  listInventoryProducts: mocks.products,
  getStockLevelsForProduct: vi.fn(),
  rebuildStockCaches: vi.fn(),
}));
vi.mock('@alga-psa/inventory/components/ImportOpeningBalances', () => ({ ImportOpeningBalances: () => null }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const t = (key: string, fallback?: string) => fallback ?? key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t }) }));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  usePageCreateShortcut: () => {},
  useDialogSubmitShortcut: () => {},
}));
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: {
    data: Product[];
    columns: Array<{ render?: (value: undefined, row: Product) => React.ReactNode }>;
  }) => <div>{data.map(row => <div key={row.service_id}>{columns.map((col, i) =>
    <span key={i}>{col.render?.(undefined, row)}</span>)}</div>)}</div>,
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/EmptyState', () => ({ EmptyState: () => null }));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: React.PropsWithChildren<{ isOpen: boolean; footer?: React.ReactNode }>) =>
    isOpen ? <div role="dialog">{children}<footer>{footer}</footer></div> : null,
}));
vi.mock('@alga-psa/ui/components/CurrencyInput', () => ({
  CurrencyInput: ({ id, value, onChange }: { id: string; value?: number; onChange: (value: number) => void }) =>
    <input id={id} value={value ?? ''} onChange={event => onChange(Number(event.target.value))} />,
}));

type Product = React.ComponentProps<typeof StockOverview>['initialProducts'][number];
const product = (overrides: Partial<Product>): Product => ({
  tenant: 'tenant-1', service_id: 'cable', service_name: 'Network Cable', sku: 'CAB-42',
  track_stock: true, is_serialized: false, is_kit: false, creates_asset_on_delivery: false,
  cost_currency: 'USD', kit_pricing_mode: 'sum_components',
  on_hand: 10, available: 10, needs_reorder: false, any_out: false,
  out_locations: 0, low_locations: 0, ...overrides,
});
const products = [
  product({}),
  product({ service_id: 'router', service_name: 'Office Router', sku: 'RTR-99', is_serialized: true, default_location_id: 'warehouse' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  mocks.locations.mockResolvedValue([
    { location_id: 'warehouse', name: 'Main Warehouse' },
    { location_id: 'van', name: 'Service Van' },
  ]);
  mocks.receive.mockResolvedValue({ warnings: [] });
  mocks.products.mockResolvedValue(products);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openReceive() {
  render(<StockOverview initialProducts={products} />);
  await waitFor(() => expect(mocks.locations).toHaveBeenCalledWith({ includeInactive: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
}
const choose = (label: string, searchPlaceholder: string, term: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), { target: { value: term } });
  fireEvent.click(screen.getByRole('option', { name: option }));
};

describe('Receive stock searchable pickers', () => {
  it('keeps Product and Location labels, IDs and placeholders', async () => {
    await openReceive();
    expect(screen.getByRole('combobox', { name: /Product/ }).id).toBe('receive-stock-product');
    expect(screen.getByRole('combobox', { name: /Location/ }).id).toBe('receive-stock-location');
    expect(screen.getByText('Select a product…')).toBeTruthy();
    expect(screen.getByText('Select a location…')).toBeTruthy();
    expect(document.querySelector('footer #receive-stock-save')).toBeTruthy();
  });

  it('searches product names and SKUs case-insensitively inside the dialog', async () => {
    await openReceive();
    fireEvent.click(screen.getByRole('combobox', { name: /Product/ }));
    expect(screen.getByRole('dialog').contains(screen.getByRole('listbox'))).toBe(true);
    const search = screen.getByPlaceholderText('Search products or SKU...');
    fireEvent.change(search, { target: { value: 'rtr-99' } });
    expect(screen.getAllByRole('option').map(node => node.textContent)).toEqual(['Office Router — RTR-99']);
    fireEvent.change(search, { target: { value: 'NETWORK' } });
    expect(screen.getAllByRole('option').map(node => node.textContent)).toEqual(['Network Cable — CAB-42']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No products found')).toBeTruthy();
  });

  it('searches locations and shows an explicit no-results message', async () => {
    await openReceive();
    fireEvent.click(screen.getByRole('combobox', { name: /Location/ }));
    const search = screen.getByPlaceholderText('Search locations...');
    fireEvent.change(search, { target: { value: 'VAN' } });
    expect(screen.getAllByRole('option').map(node => node.textContent)).toEqual(['Service Van']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No locations found')).toBeTruthy();
  });

  it('selects a matching product using the keyboard', async () => {
    await openReceive();
    fireEvent.click(screen.getByRole('combobox', { name: /Product/ }));
    const search = screen.getByPlaceholderText('Search products or SKU...');
    fireEvent.change(search, { target: { value: 'rtr-99' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('combobox', { name: /Product/ }).textContent).toContain('Office Router');
    expect(document.getElementById('receive-stock-serials')).toBeTruthy();
  });

  it('clears the search when reopening without discarding the selected product', async () => {
    await openReceive();
    choose('Product', 'Search products or SKU...', 'cab-42', 'Network Cable — CAB-42');
    fireEvent.click(screen.getByRole('combobox', { name: /Product/ }));
    expect(screen.getByPlaceholderText<HTMLInputElement>('Search products or SKU...').value).toBe('');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('combobox', { name: /Product/ }).textContent).toContain('Network Cable');
  });

  it('still requires a product and location before receiving', async () => {
    await openReceive();
    fireEvent.click(document.getElementById('receive-stock-save')!);
    expect(mocks.receive).not.toHaveBeenCalled();
    choose('Product', 'Search products or SKU...', 'cab-42', 'Network Cable — CAB-42');
    fireEvent.click(document.getElementById('receive-stock-save')!);
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it('keeps the form selections when receiving fails', async () => {
    mocks.receive.mockRejectedValue(new Error('Receive failed'));
    await openReceive();
    choose('Product', 'Search products or SKU...', 'cab-42', 'Network Cable — CAB-42');
    choose('Location', 'Search locations...', 'van', 'Service Van');
    fireEvent.change(document.getElementById('receive-stock-quantity')!, { target: { value: '3' } });
    fireEvent.click(document.getElementById('receive-stock-save')!);
    await waitFor(() => expect(mocks.receive).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('combobox', { name: /Product/ }).textContent).toContain('Network Cable');
    expect(screen.getByRole('combobox', { name: /Location/ }).textContent).toContain('Service Van');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('submits the selected product and location IDs with the existing quantity and cost', async () => {
    await openReceive();
    choose('Product', 'Search products or SKU...', 'cab-42', 'Network Cable — CAB-42');
    choose('Location', 'Search locations...', 'van', 'Service Van');
    fireEvent.change(document.getElementById('receive-stock-quantity')!, { target: { value: '3' } });
    fireEvent.change(document.getElementById('receive-stock-unit-cost')!, { target: { value: '12.50' } });
    fireEvent.click(document.getElementById('receive-stock-save')!);
    await waitFor(() => expect(mocks.receive).toHaveBeenCalledWith({
      service_id: 'cable', location_id: 'van', quantity: 3, unit_cost: 1250, serials: undefined,
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('preserves row product/default-location selection and serialized receiving', async () => {
    render(<StockOverview initialProducts={products} />);
    await waitFor(() => expect(mocks.locations).toHaveBeenCalled());
    fireEvent.click(document.getElementById('receive-stock-router')!);
    expect(screen.getByRole('combobox', { name: /Product/ }).textContent).toContain('Office Router');
    expect(screen.getByRole('combobox', { name: /Location/ }).textContent).toContain('Main Warehouse');
    fireEvent.change(document.getElementById('receive-stock-serials')!, { target: { value: 'SN-1\nSN-2' } });
    fireEvent.click(document.getElementById('receive-stock-save')!);
    await waitFor(() => expect(mocks.receive).toHaveBeenCalledWith({
      service_id: 'router', location_id: 'warehouse', quantity: 2, unit_cost: 0,
      serials: [{ serial_number: 'SN-1' }, { serial_number: 'SN-2' }],
    }));
  });
});
