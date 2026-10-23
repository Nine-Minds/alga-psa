// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KitManager } from './KitManager';

const getKitDetail = vi.fn();
const createKitProduct = vi.fn();
const listKitTenantUnits = vi.fn(async () => [] as Array<{ code: string; label: string }>);
const registerKitTenantUnit = vi.fn();

vi.mock('../actions', () => ({
  addKitComponent: vi.fn(),
  createKitProduct: (...args: unknown[]) => createKitProduct(...args),
  getKitDetail: (...args: unknown[]) => getKitDetail(...args),
  listKitComponentCandidates: vi.fn(async () => []),
  listKitSummaries: vi.fn(async () => []),
  listKitTenantUnits: () => listKitTenantUnits(),
  registerKitTenantUnit: (...args: unknown[]) => registerKitTenantUnit(...args),
  removeKitComponent: vi.fn(),
  updateKitProduct: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (_key: string, fallback?: string | { defaultValue?: string; [key: string]: unknown }, values?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? _key;
      const replacements = typeof fallback === 'object' ? fallback : values ?? {};
      return template.replace(/{{(\w+)}}/g, (_match, name) => String(replacements[name] ?? ''));
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) =>
    asChild && React.isValidElement(children)
      ? React.cloneElement(children as React.ReactElement<any>, props)
      : <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) => (
    <label>
      {label && <span>{label}</span>}
      <input {...props} />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, label, value, options, onValueChange }: any) => (
    <label>
      {label && <span>{label}</span>}
      <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
        {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) => isOpen ? <section><h2>{title}</h2>{children}{footer}</section> : null,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <strong>{children}</strong>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

const kit = {
  service_id: 'kit-1',
  service_name: 'Desk setup kit',
  sku: 'KIT-1',
  default_rate: 99999,
  cost: null,
  cost_currency: 'USD',
  kit_pricing_mode: 'sum',
  kit_fixed_price: null,
  component_count: 1,
  stocked_component_count: 1,
  short_component_count: 0,
  buildable_quantity: 4,
  status: 'ready',
  computed_price: 50000,
  component_cost: 350,
  margin_amount: 49650,
  margin_percent: 0.993,
  sales_order_count: 2,
};

const detail = {
  ...kit,
  description: null,
  custom_service_type_id: 'type-1',
  unit_of_measure: 'kit',
  is_active: true,
  components: [{
    tenant: 'tenant-1',
    kit_service_id: 'kit-1',
    component_service_id: 'component-1',
    quantity: 2,
    service_name: 'Monitor',
    sku: 'MON-1',
    item_kind: 'product',
    track_stock: true,
    is_serialized: false,
    default_rate: 25000,
    cost: 175,
    average_cost: null,
    cost_currency: 'USD',
    on_hand: 10,
    available: 8,
    unit_cost: 175,
    extended_cost: 350,
    extended_price: 50000,
    component_buildable_quantity: 4,
  }],
  sales_order_behavior: {
    parent_line_price: 50000,
    component_lines_priced_at: 0,
    explodes_on_sales_order: true,
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listKitTenantUnits.mockImplementation(async () => []);
});

describe('KitManager pricing policy UI', () => {
  it('renders sum as calculated, fixed as one field, and keeps Create kit conditional', async () => {
    getKitDetail.mockResolvedValue(detail);
    render(
      <KitManager
        initialKits={[kit as any]}
        serviceTypes={[{ id: 'type-1', name: 'Hardware', is_standard: false }]}
        componentCandidates={[]}
      />,
    );

    await screen.findAllByText('Calculated kit price');
    expect(document.querySelector('#kit-price')).toBeNull();
    expect(document.querySelector('#kit-fixed-price')).toBeNull();
    expect(screen.getByText('Component selling prices × quantity')).toBeTruthy();
    expect(screen.getByText(/\$250\.00 each/)).toBeTruthy();
    expect(screen.getByText(/\$500\.00 extended/)).toBeTruthy();
    expect(document.querySelector('#kit-create-sales-order-link')?.getAttribute('href'))
      .toBe('/msp/inventory/sales-orders?create=1&service_id=kit-1');
    expect(document.querySelector('#kit-view-sales-orders-link')?.getAttribute('href'))
      .toBe('/msp/inventory/sales-orders?service_id=kit-1');

    const previewQuantity = document.querySelector('#kit-sales-order-preview-quantity') as HTMLInputElement;
    fireEvent.change(previewQuantity, { target: { value: '3' } });
    expect(await screen.findByText('3 × Desk setup kit')).toBeTruthy();
    expect(screen.getByText('6 × Monitor')).toBeTruthy();
    expect(screen.getByText('$1,500.00')).toBeTruthy();

    fireEvent.change(document.querySelector('#kit-pricing-mode')!, { target: { value: 'fixed' } });
    await waitFor(() => expect(document.querySelector('#kit-fixed-price')).not.toBeNull());
    expect(document.querySelectorAll('#kit-fixed-price')).toHaveLength(1);
    expect(document.querySelector('#kit-price')).toBeNull();

    fireEvent.click(document.querySelector('#kits-create-kit-button')!);
    await screen.findByText('Price will be calculated after components are added.');
    expect(document.querySelector('#kit-create-fixed-price')).toBeNull();

    fireEvent.change(document.querySelector('#kit-create-pricing-mode')!, { target: { value: 'fixed' } });
    await waitFor(() => expect(document.querySelector('#kit-create-fixed-price')).not.toBeNull());
    expect(document.querySelectorAll('#kit-create-fixed-price')).toHaveLength(1);

    fireEvent.click(document.querySelector('#kit-create-cancel')!);
    fireEvent.click(document.querySelector('#kits-create-kit-button')!);
    expect((document.querySelector('#kit-create-pricing-mode') as HTMLSelectElement).value).toBe('sum');
    expect(document.querySelector('#kit-create-fixed-price')).toBeNull();
  });

  it('renders empty, filtered, and inline retry states', async () => {
    const { unmount } = render(
      <KitManager
        initialKits={[]}
        serviceTypes={[]}
        componentCandidates={[]}
      />,
    );

    expect(screen.getByText('No inventory kits yet')).toBeTruthy();
    unmount();

    getKitDetail.mockRejectedValueOnce(new Error('network unavailable'));
    render(
      <KitManager
        initialKits={[kit as any]}
        serviceTypes={[{ id: 'type-1', name: 'Hardware', is_standard: false }]}
        componentCandidates={[]}
      />,
    );

    expect(await screen.findByText('Could not load this kit')).toBeTruthy();
    getKitDetail.mockResolvedValueOnce(detail);
    fireEvent.click(document.querySelector('#kits-detail-retry-button')!);
    expect(await screen.findAllByText('Calculated kit price')).toHaveLength(2);

    fireEvent.change(document.querySelector('#kits-search')!, { target: { value: 'missing kit' } });
    expect(screen.getByText('No kits match those filters.')).toBeTruthy();
    fireEvent.change(document.querySelector('#kits-search')!, { target: { value: '' } });
    fireEvent.change(document.querySelector('#kits-status-filter')!, { target: { value: 'no_bom' } });
    expect(screen.getByText('No kits match those filters.')).toBeTruthy();
  });

  it('offers tenant units in Create kit and submits the chosen unit code and label', async () => {
    listKitTenantUnits.mockResolvedValue([{ code: 'XBX', label: 'Crate' }]);
    registerKitTenantUnit.mockResolvedValue({ code: 'C62', label: 'Bundle' });
    createKitProduct.mockResolvedValue({ ...detail, service_id: 'kit-2', service_name: 'Crate kit' });
    render(
      <KitManager
        initialKits={[]}
        serviceTypes={[{ id: 'type-1', name: 'Hardware', is_standard: false }]}
        componentCandidates={[]}
      />,
    );

    fireEvent.click(document.querySelector('#kits-create-kit-button')!);
    fireEvent.change(document.querySelector('#kit-create-name')!, { target: { value: 'Crate kit' } });
    fireEvent.change(document.querySelector('#kit-create-product-type')!, { target: { value: 'type-1' } });

    const unitSelect = document.querySelector('#kit-create-unit-of-measure') as HTMLSelectElement;
    await waitFor(() => expect(unitSelect.querySelector('option[value="custom:XBX:Crate"]')).not.toBeNull());
    expect(listKitTenantUnits).toHaveBeenCalledTimes(1);

    fireEvent.change(unitSelect, { target: { value: 'custom:XBX:Crate' } });
    fireEvent.click(document.querySelector('#kit-create-submit')!);
    await waitFor(() => expect(createKitProduct).toHaveBeenCalledTimes(1));
    expect(createKitProduct.mock.calls[0][0]).toMatchObject({ unit_code: 'XBX', unit_of_measure: 'Crate' });

    fireEvent.click(document.querySelector('#kits-create-kit-button')!);
    fireEvent.change(document.querySelector('#kit-create-name')!, { target: { value: 'Bundle kit' } });
    fireEvent.change(document.querySelector('#kit-create-product-type')!, { target: { value: 'type-1' } });
    fireEvent.change(document.querySelector('#kit-create-unit-of-measure')!, { target: { value: '__custom_unit__' } });
    fireEvent.change(document.querySelector('#kit-create-unit-of-measure-custom')!, { target: { value: 'Bundle' } });
    fireEvent.click(document.querySelector('#kit-create-unit-of-measure-register')!);
    await waitFor(() => expect(registerKitTenantUnit).toHaveBeenCalledWith('Bundle'));
    await waitFor(() => expect(document.querySelector('#kit-create-unit-of-measure-custom')).toBeNull());

    fireEvent.click(document.querySelector('#kit-create-submit')!);
    await waitFor(() => expect(createKitProduct).toHaveBeenCalledTimes(2));
    expect(createKitProduct.mock.calls[1][0]).toMatchObject({ unit_code: 'C62', unit_of_measure: 'Bundle' });
  });
});
