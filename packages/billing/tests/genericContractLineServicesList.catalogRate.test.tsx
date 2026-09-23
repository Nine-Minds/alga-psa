// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  getContractLineServicesWithConfigurations: vi.fn(),
  addServiceToContractLine: vi.fn(),
  removeServiceFromContractLine: vi.fn(),
  getServices: vi.fn(),
  getContractLineById: vi.fn(),
  getContractById: vi.fn(),
  getServiceCategories: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/contractLineServiceActions', () => ({
  getContractLineServicesWithConfigurations: actions.getContractLineServicesWithConfigurations,
  addServiceToContractLine: actions.addServiceToContractLine,
  removeServiceFromContractLine: actions.removeServiceFromContractLine,
}));

vi.mock('@alga-psa/billing/actions/serviceActions', () => ({
  getServices: actions.getServices,
}));

vi.mock('@alga-psa/billing/actions/contractLineAction', () => ({
  getContractLineById: actions.getContractLineById,
}));

vi.mock('@alga-psa/billing/actions/contractActions', () => ({
  getContractById: actions.getContractById,
}));

vi.mock('@alga-psa/billing/actions/categoryActions', () => ({
  getServiceCategories: actions.getServiceCategories,
}));

vi.mock('../src/components/billing-dashboard/contract-lines/ContractLineServiceForm', () => ({
  default: () => null,
}));

vi.mock('@radix-ui/themes', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, checked, onChange }: any) => (
    <input
      id={id}
      type="checkbox"
      checked={Boolean(checked)}
      onChange={onChange}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: () => null,
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@alga-psa/core', () => ({
  getCurrencySymbol: () => '$',
}));

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: () => 'action error',
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

const translate = (key: string, options?: Record<string, unknown>) => {
  let value = String(options?.defaultValue ?? key);
  for (const [name, replacement] of Object.entries(options ?? {})) {
    value = value.replace(`{{${name}}}`, String(replacement));
  }
  return value;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
}));

import GenericPlanServicesList from '../src/components/billing-dashboard/contract-lines/GenericContractLineServicesList';

const hourlyServices = [
  {
    service_id: 'default-only',
    service_name: 'Default only',
    service_type_name: 'Support',
    billing_method: 'hourly',
    unit_of_measure: 'hour',
    item_kind: 'service',
    is_active: true,
    default_rate: 18000,
  },
  {
    service_id: 'priced',
    service_name: 'Priced service',
    service_type_name: 'Support',
    billing_method: 'hourly',
    unit_of_measure: 'hour',
    item_kind: 'service',
    is_active: true,
    default_rate: 18000,
    prices: [{ currency_code: 'USD', rate: 25000 }],
  },
  {
    service_id: 'unpriced',
    service_name: 'Unpriced service',
    service_type_name: 'Support',
    billing_method: 'hourly',
    unit_of_measure: 'hour',
    item_kind: 'service',
    is_active: true,
    default_rate: null,
  },
  {
    service_id: 'product-item',
    service_name: 'Catalog product',
    service_type_name: 'Hardware',
    billing_method: 'fixed',
    unit_of_measure: 'item',
    item_kind: 'product',
    is_active: true,
    default_rate: 0,
  },
];

const renderList = () =>
  render(
    <GenericPlanServicesList contractLineId="line-1" />,
  );

describe('GenericContractLineServicesList catalog rate resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.getContractLineById.mockResolvedValue({
      contract_line_id: 'line-1',
      contract_id: 'contract-1',
      contract_line_type: 'Hourly',
      billing_frequency: 'monthly',
    });
    actions.getContractById.mockResolvedValue({ currency_code: 'USD' });
    actions.getContractLineServicesWithConfigurations.mockResolvedValue([]);
    actions.getServiceCategories.mockResolvedValue([]);
    actions.addServiceToContractLine.mockResolvedValue(undefined);
    actions.removeServiceFromContractLine.mockResolvedValue(undefined);
    actions.getServices.mockResolvedValue({
      services: hourlyServices,
      totalCount: hourlyServices.length,
    });
  });

  it('T002: displays and submits default_rate with no manual rate input when no currency price exists', async () => {
    renderList();

    expect(await screen.findByText('Default only')).not.toBeNull();
    expect(screen.getByText(/Catalog default: \$180\.00/)).not.toBeNull();

    fireEvent.click(document.getElementById('add-generic-service-default-only')!);
    expect(screen.queryByPlaceholderText('Enter rate')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Add Selected \(1\) Services/ }));

    await waitFor(() =>
      expect(actions.addServiceToContractLine).toHaveBeenCalledWith(
        'line-1',
        'default-only',
        1,
        18000,
      ),
    );
  });

  it('T003: prefers an exact contract-currency price over default_rate', async () => {
    renderList();

    expect(await screen.findByText('Priced service')).not.toBeNull();
    expect(screen.getByText(/Rate: \$250\.00/)).not.toBeNull();

    fireEvent.click(document.getElementById('add-generic-service-priced')!);
    fireEvent.click(screen.getByRole('button', { name: /Add Selected \(1\) Services/ }));

    await waitFor(() =>
      expect(actions.addServiceToContractLine).toHaveBeenCalledWith(
        'line-1',
        'priced',
        1,
        25000,
      ),
    );
  });

  it('T003: blocks an unresolved service until a valid manual rate is entered, then submits it in cents', async () => {
    renderList();

    expect(await screen.findByText('Unpriced service')).not.toBeNull();
    expect(screen.getByText(/No usable USD catalog rate/)).not.toBeNull();

    fireEvent.click(document.getElementById('add-generic-service-unpriced')!);
    fireEvent.click(screen.getByRole('button', { name: /Add Selected \(1\) Services/ }));

    await waitFor(() => expect(actions.addServiceToContractLine).not.toHaveBeenCalled());
    expect(screen.getByText(/Please enter a rate for "Unpriced service"/)).not.toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Enter rate'), { target: { value: '12.50' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Selected \(1\) Services/ }));

    await waitFor(() =>
      expect(actions.addServiceToContractLine).toHaveBeenCalledWith(
        'line-1',
        'unpriced',
        1,
        1250,
      ),
    );
  });

  it('T002: keeps product items out of the hourly selector', async () => {
    renderList();

    expect(await screen.findByText('Default only')).not.toBeNull();
    expect(screen.queryByText('Catalog product')).toBeNull();
  });
});
