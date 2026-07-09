// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalesOrdersManager } from './SalesOrdersManager';

const createSalesOrder = vi.fn(async (_input: any) => ({ so_id: 'so-1', lines: [] }));
const navigationState = vi.hoisted(() => ({ params: {} as Record<string, string> }));

vi.mock('../actions', () => ({
  cancelSalesOrder: vi.fn(),
  confirmSalesOrder: vi.fn(),
  createSalesOrder: (input: any) => createSalesOrder(input),
  listSalesOrders: vi.fn(async () => []),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: (key: string) => navigationState.params[key] ?? null }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (_key: string, fallback?: string, values?: Record<string, unknown>) =>
    (fallback ?? _key).replace(/{{(\w+)}}/g, (_match, name) => String(values?.[name] ?? ''));
  return { useTranslation: () => ({ t }) };
});

vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: () => <div /> }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) => (
    <label>{label && <span>{label}</span>}<input {...props} /></label>
  ),
}));
vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: React.ReactNode }) => (
    <label>{label && <span>{label}</span>}<textarea {...props} /></label>
  ),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ id, isOpen, title, children }: any) => isOpen ? <section id={id}><h2>{title}</h2>{children}</section> : null,
}));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, label, value, options, onValueChange }: any) => (
    <label>{label && <span>{label}</span>}<select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
  ),
}));
vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  default: ({ id, value, options, onChange }: any) => (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select</option>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ id, selectedClientId, clients, onSelect }: any) => (
    <select id={id} value={selectedClientId ?? ''} onChange={(event) => onSelect(event.target.value || null)}>
      <option value="">Select</option>
      {clients.map((client: any) => <option key={client.client_id} value={client.client_id}>{client.client_name}</option>)}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <>{children}</>,
  DropdownMenuItem: ({ children }: any) => <>{children}</>,
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
}));
vi.mock('./SalesOrderDetail', () => ({ SalesOrderDetail: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  navigationState.params = {};
});

const props = {
  initialSos: [],
  locations: [],
  clients: [{ client_id: 'client-1', client_name: 'Acme', default_currency_code: 'USD' } as any],
  services: [{
    service_id: 'kit-1',
    service_name: 'Desk setup kit',
    sku: 'KIT-1',
    default_rate: 99999,
    is_kit: true,
    kit_pricing_mode: 'sum' as const,
    resolved_kit_price: 50000,
    kit_currency: 'USD',
  }],
  fulfillAndInvoice: vi.fn(),
  generateInvoice: vi.fn(),
  confirmDropShip: vi.fn(),
};

describe('SalesOrdersManager kit price override', () => {
  it('opens the existing create flow with a requested kit preselected', async () => {
    navigationState.params = { create: '1', service_id: 'kit-1' };
    render(<SalesOrdersManager {...props} />);

    await waitFor(() => expect(document.querySelector('#sales-order-dialog')).not.toBeNull());
    const service = document.querySelector('#sales-order-line-service-0') as HTMLSelectElement;
    const price = document.querySelector('#sales-order-line-price-0') as HTMLInputElement;
    expect(service.value).toBe('kit-1');
    expect(price.value).toBe('500');
    expect(screen.getByText('Calculated from components')).toBeTruthy();
  });

  it('explains when the sales-order list is scoped to kit usage', () => {
    navigationState.params = { service_id: 'kit-1' };
    render(<SalesOrdersManager {...props} />);
    expect(screen.getByText('Showing sales orders using Desk setup kit.')).toBeTruthy();
    expect(document.querySelector('#sales-orders-clear-service-filter')).not.toBeNull();
  });

  it('marks an edited kit price as an override and reset clears override intent', async () => {
    render(<SalesOrdersManager {...props} />);
    fireEvent.click(document.querySelector('#sales-orders-add-button')!);
    fireEvent.change(document.querySelector('#sales-order-client')!, { target: { value: 'client-1' } });
    fireEvent.change(document.querySelector('#sales-order-line-service-0')!, { target: { value: 'kit-1' } });

    const price = document.querySelector('#sales-order-line-price-0') as HTMLInputElement;
    expect(price.value).toBe('500');
    expect(screen.getByText('Calculated from components')).toBeTruthy();

    fireEvent.change(price, { target: { value: '450' } });
    expect(await screen.findByText('Overridden from $500.00 for this sales order')).toBeTruthy();

    fireEvent.click(document.querySelector('#sales-order-line-price-reset-0')!);
    await waitFor(() => expect(price.value).toBe('500'));
    expect(screen.getByText('Calculated from components')).toBeTruthy();

    fireEvent.click(document.querySelector('#sales-order-save')!);
    await waitFor(() => expect(createSalesOrder).toHaveBeenCalledTimes(1));
    const submitted = createSalesOrder.mock.calls[0][0] as any;
    expect(submitted.lines[0].unit_price).toBeUndefined();
    expect(submitted.lines[0].kit_unit_price_override).toBeUndefined();
  });

  it('submits a changed kit price only as the explicit one-order override', async () => {
    render(<SalesOrdersManager {...props} />);
    fireEvent.click(document.querySelector('#sales-orders-add-button')!);
    fireEvent.change(document.querySelector('#sales-order-client')!, { target: { value: 'client-1' } });
    fireEvent.change(document.querySelector('#sales-order-line-service-0')!, { target: { value: 'kit-1' } });
    fireEvent.change(document.querySelector('#sales-order-line-price-0')!, { target: { value: '450' } });
    fireEvent.click(document.querySelector('#sales-order-save')!);

    await waitFor(() => expect(createSalesOrder).toHaveBeenCalledTimes(1));
    const submitted = createSalesOrder.mock.calls[0][0] as any;
    expect(submitted.lines[0].unit_price).toBeUndefined();
    expect(submitted.lines[0].kit_unit_price_override).toBe(45000);
  });
});
