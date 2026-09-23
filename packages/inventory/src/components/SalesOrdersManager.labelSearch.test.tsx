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
  return { useTranslation: () => ({ t }), useOptionalI18n: () => null };
});

// The line-item picker is the real SearchableSelect so the label/secondary-label
// search contract is exercised end to end; only its reflection hook is stubbed.
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: (component: { id?: string }) => ({
    automationIdProps: { id: component.id ?? 'searchable-select' },
    updateMetadata: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({ DataTable: () => <div /> }));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    ({ children, ...props }, ref) => <button ref={ref} {...props}>{children}</button>,
  ),
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

// cmdk (inside SearchableSelect) observes its list; jsdom lacks these APIs.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  navigationState.params = {};
});

const props = {
  initialSos: [],
  locations: [],
  clients: [{ client_id: 'client-1', client_name: 'Acme', default_currency_code: 'USD' } as any],
  services: [
    {
      service_id: 'svc-1',
      service_name: 'Professional Business IP Phone',
      sku: 'FTS-00004',
      product_category: 'Grandstream GRP2614',
      default_rate: 10000,
    },
    {
      service_id: 'svc-2',
      service_name: 'Decoy Widget',
      sku: 'WID-1',
      product_category: null,
      default_rate: 500,
    },
  ],
  fulfillAndInvoice: vi.fn(),
  generateInvoice: vi.fn(),
  confirmDropShip: vi.fn(),
};

async function openServicePickerAndSearch(term: string) {
  render(<SalesOrdersManager {...props} />);
  await waitFor(() => expect(document.querySelector('#sales-orders-add-button')).not.toBeNull());
  fireEvent.click(document.querySelector('#sales-orders-add-button')!);
  await waitFor(() => expect(document.querySelector('#sales-order-line-service-0')).not.toBeNull());
  fireEvent.click(document.querySelector('#sales-order-line-service-0')!);
  // cmdk owns the ids on its input/list; select the search box by its attribute.
  const search = await waitFor(() => {
    const input = document.querySelector('input[cmdk-input]') as HTMLInputElement | null;
    if (!input) throw new Error('picker search not open');
    return input;
  });
  fireEvent.change(search, { target: { value: term } });
}

describe('SalesOrdersManager line-item picker Category Label search', () => {
  it('matches a mixed-case label-only substring and shows the Label as secondary text', async () => {
    await openServicePickerAndSearch('grp26');

    expect(await screen.findByText('Professional Business IP Phone (FTS-00004)')).toBeTruthy();
    expect(screen.getByText('Grandstream GRP2614')).toBeTruthy();
    expect(screen.queryByText('Decoy Widget (WID-1)')).toBeNull();
  });

  it('still matches on product Name', async () => {
    await openServicePickerAndSearch('business');

    expect(await screen.findByText('Professional Business IP Phone (FTS-00004)')).toBeTruthy();
    expect(screen.queryByText('Decoy Widget (WID-1)')).toBeNull();
  });

  it('still matches on SKU', async () => {
    await openServicePickerAndSearch('fts-00004');

    expect(await screen.findByText('Professional Business IP Phone (FTS-00004)')).toBeTruthy();
    expect(screen.queryByText('Decoy Widget (WID-1)')).toBeNull();
  });

  it('keeps the closed trigger to Name (SKU) and does not leak the Label', async () => {
    await openServicePickerAndSearch('grp26');

    fireEvent.click(await screen.findByText('Professional Business IP Phone (FTS-00004)'));

    await waitFor(() => expect(screen.queryByText('Grandstream GRP2614')).toBeNull());
    const trigger = document.querySelector('#sales-order-line-service-0') as HTMLButtonElement;
    expect(trigger.textContent).toContain('Professional Business IP Phone (FTS-00004)');
    expect(trigger.textContent).not.toContain('Grandstream GRP2614');
  });
});
