// @vitest-environment jsdom
/**
 * alga0002089: the PO Amount field used symbol() (tenant default), so a new
 * contract for a EUR client showed "Currency: EUR" but "$" in PO Amount.
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getAllClientsForBilling: vi.fn(),
  getContractLinePresets: vi.fn(),
  getContractLinePresetServiceCounts: vi.fn(),
  getContractLinePresetServices: vi.fn(),
  getContractLinePresetFixedConfig: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getAllClientsForBilling: actionMocks.getAllClientsForBilling,
  createClientContractForBilling: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({
  getContractLinePresets: actionMocks.getContractLinePresets,
  getContractLinePresetServiceCounts: actionMocks.getContractLinePresetServiceCounts,
  getContractLinePresetServices: actionMocks.getContractLinePresetServices,
  getContractLinePresetFixedConfig: actionMocks.getContractLinePresetFixedConfig,
  copyPresetToContractLine: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  createContract: vi.fn(),
  updateContract: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServices: vi.fn(async () => []),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useContractLineTypeOptions: () => [{ value: 'Fixed', label: 'Fixed' }],
  useFormatContractLineType: () => (value?: string | null) => value ?? '',
  useFormatBillingFrequency: () => (value?: string | null) => value ?? '',
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€' };

// No argument yields a distinct tenant-default marker so a regression to
// symbol() (tenant currency instead of the contract's) is visible.
vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    money: (value: number, currency?: string) => `${currency ? SYMBOLS[currency] : 'TENANT-DEFAULT'}${value}`,
    symbol: (currency?: string) => (currency ? SYMBOLS[currency] : 'TENANT-DEFAULT'),
  }),
}));

vi.mock('@alga-psa/core', () => ({
  CURRENCY_OPTIONS: [{ value: 'USD', label: 'USD' }],
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="contract-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ clients, onSelect }: { clients: Array<{ client_id: string; client_name: string }>; onSelect: (id: string) => void }) => (
    <div data-testid="client-picker">
      {clients.map((c) => (
        <button key={c.client_id} type="button" onClick={() => onSelect(c.client_id)}>
          {`pick ${c.client_name}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => <div data-testid="custom-select" />,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <div data-testid="date-picker" />,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: { id?: string; checked?: boolean; onCheckedChange?: (v: boolean) => void }) => (
    <button type="button" data-testid={`switch-${id}`} onClick={() => onCheckedChange?.(!checked)} />
  ),
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: () => <div data-testid="checkbox" />,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const clients = [
  { client_id: 'client-eur', client_name: 'Euro Client', default_currency_code: 'EUR' },
  { client_id: 'client-usd', client_name: 'Dollar Client', default_currency_code: 'USD' },
];

const { ContractDialog } = await import('../src/components/billing-dashboard/contracts/ContractDialog');

const poAmountAdornment = () => {
  const input = document.getElementById('po_amount') as HTMLInputElement;
  const span = input.previousElementSibling as HTMLElement | null;
  // Rendered by Input's own leadingAdornment, inside the same wrapper.
  expect(span?.getAttribute('aria-hidden')).toBe('true');
  expect(span?.parentElement).toBe(input.parentElement);
  return span?.textContent;
};

describe('ContractDialog PO amount currency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getAllClientsForBilling.mockResolvedValue(clients);
    actionMocks.getContractLinePresets.mockResolvedValue([]);
    actionMocks.getContractLinePresetServiceCounts.mockResolvedValue({});
  });
  afterEach(() => cleanup());

  it.each([
    ['Euro Client', '€'],
    ['Dollar Client', '$'],
  ])('shows the contract currency symbol for %s', async (clientName, expected) => {
    render(<ContractDialog onContractSaved={vi.fn()} isOpen onOpenChange={vi.fn()} />);

    fireEvent.click(await screen.findByText(`pick ${clientName}`));
    fireEvent.click(screen.getByTestId('switch-po_required'));

    await waitFor(() => expect(document.getElementById('po_amount')).not.toBeNull());
    expect(poAmountAdornment()).toBe(expected);
  });

  it('follows an existing contract currency over the client default', async () => {
    render(
      <ContractDialog
        onContractSaved={vi.fn()}
        isOpen
        onOpenChange={vi.fn()}
        editingContract={{ contract_id: 'c-1', contract_name: 'Existing', currency_code: 'EUR' } as any}
      />,
    );

    fireEvent.click(await screen.findByText('pick Dollar Client'));
    fireEvent.click(screen.getByTestId('switch-po_required'));

    await waitFor(() => expect(document.getElementById('po_amount')).not.toBeNull());
    expect(poAmountAdornment()).toBe('€');
  });
});
