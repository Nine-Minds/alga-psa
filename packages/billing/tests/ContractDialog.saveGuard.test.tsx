// @vitest-environment jsdom
//
// One save per click. The quick-add dialog had no in-flight guard, so a
// double-click on Create Contract (or Save as Draft) ran the save twice and
// left a second contract behind — the duplicate this card exists to stop.

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getClientByIdForBilling: vi.fn(),
  getContractLinePresets: vi.fn(),
  getContractLinePresetServiceCounts: vi.fn(),
  getContractLinePresetServices: vi.fn(),
  getContractLinePresetFixedConfig: vi.fn(),
  saveQuickAddContract: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientByIdForBilling: actionMocks.getClientByIdForBilling,
}));

vi.mock('@alga-psa/billing/actions/contractLinePresetActions', () => ({
  getContractLinePresets: actionMocks.getContractLinePresets,
  getContractLinePresetServiceCounts: actionMocks.getContractLinePresetServiceCounts,
  getContractLinePresetServices: actionMocks.getContractLinePresetServices,
  getContractLinePresetFixedConfig: actionMocks.getContractLinePresetFixedConfig,
}));

vi.mock('@alga-psa/billing/actions/contractWizardActions', () => ({
  saveQuickAddContract: actionMocks.saveQuickAddContract,
}));

vi.mock('@alga-psa/billing/actions/billingProfileActions', () => ({
  getClientBillingProfilesForBilling: vi.fn(async () => []),
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

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({
    money: (value: number) => `$${(value / 100).toFixed(2)}`,
    symbol: () => '$',
  }),
}));

vi.mock('@alga-psa/core', () => ({
  CURRENCY_OPTIONS: [{ value: 'USD', label: 'USD' }],
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({ renderQuickAddClient: () => null }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: { isOpen: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
    isOpen ? <div data-testid="contract-dialog">{children}{footer}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ onSelect }: { onSelect: (id: string | null) => void }) => (
    <button type="button" data-testid="client-picker" onClick={() => onSelect('client-1')}>
      pick client
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/BillingProfilePicker', () => ({
  BillingProfilePicker: () => <div data-testid="billing-profile-picker" />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => <div data-testid="custom-select" />,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ onChange }: { onChange: (date: Date | undefined) => void }) => (
    <button type="button" data-testid="date-picker" onClick={() => onChange(new Date(2026, 3, 1))}>
      pick date
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: () => <div data-testid="switch" />,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: () => <div data-testid="checkbox" />,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const { ContractDialog } = await import('../src/components/billing-dashboard/contracts/ContractDialog');

/** A save that stays in flight until the test releases it. */
const pendingSave = () => {
  let release: (value: unknown) => void = () => undefined;
  actionMocks.saveQuickAddContract.mockImplementation(
    () => new Promise((resolve) => { release = resolve; }),
  );
  return () => release({ contract_id: 'contract-1', contract_line_ids: [] });
};

const fillForm = async () => {
  await screen.findByTestId('contract-dialog');
  fireEvent.change(document.getElementById('contract-name')!, { target: { value: 'Double Clicked' } });
  fireEvent.click(screen.getByTestId('client-picker'));
  fireEvent.click(screen.getAllByTestId('date-picker')[0]);
};

describe('ContractDialog save guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.getClientByIdForBilling.mockResolvedValue(
      { client_id: 'client-1', client_name: 'Emerald City', default_currency_code: 'USD' },
    );
    actionMocks.getContractLinePresets.mockResolvedValue([]);
    actionMocks.getContractLinePresetServiceCounts.mockResolvedValue({});
  });
  afterEach(() => cleanup());

  it('saves once when the form is submitted twice in the same tick', async () => {
    const release = pendingSave();
    render(<ContractDialog onContractSaved={vi.fn()} isOpen onOpenChange={vi.fn()} />);
    await fillForm();

    const form = document.getElementById('contract-dialog-form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(actionMocks.saveQuickAddContract).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() => expect(actionMocks.saveQuickAddContract).toHaveBeenCalledTimes(1));
  });

  it('saves once when Create Contract is clicked twice', async () => {
    const release = pendingSave();
    render(<ContractDialog onContractSaved={vi.fn()} isOpen onOpenChange={vi.fn()} />);
    await fillForm();

    const saveButton = document.getElementById('save-contract-btn') as HTMLButtonElement;
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(actionMocks.saveQuickAddContract).toHaveBeenCalledTimes(1));
    // Both ways out of the dialog are closed while the save is in flight.
    await waitFor(() => expect(saveButton.disabled).toBe(true));
    expect((document.getElementById('save-draft-btn') as HTMLButtonElement).disabled).toBe(true);
    release();
  });

  it('saves once when Save as Draft is clicked twice', async () => {
    const release = pendingSave();
    render(<ContractDialog onContractSaved={vi.fn()} isOpen onOpenChange={vi.fn()} />);
    await fillForm();

    const draftButton = document.getElementById('save-draft-btn') as HTMLButtonElement;
    fireEvent.click(draftButton);
    fireEvent.click(draftButton);

    await waitFor(() => expect(actionMocks.saveQuickAddContract).toHaveBeenCalledTimes(1));
    expect(actionMocks.saveQuickAddContract.mock.calls[0][0]).toMatchObject({ save_as_active: false });
    release();
  });

  it('lets the operator save again after a refused save', async () => {
    actionMocks.saveQuickAddContract
      .mockResolvedValueOnce({ actionError: 'That billing profile belongs to a different client.' })
      .mockResolvedValueOnce({ contract_id: 'contract-1', contract_line_ids: [] });
    render(<ContractDialog onContractSaved={vi.fn()} isOpen onOpenChange={vi.fn()} />);
    await fillForm();

    const form = document.getElementById('contract-dialog-form')!;
    fireEvent.submit(form);
    await screen.findByText('That billing profile belongs to a different client.');

    fireEvent.submit(form);
    await waitFor(() => expect(actionMocks.saveQuickAddContract).toHaveBeenCalledTimes(2));
  });
});
