/**
 * @vitest-environment jsdom
 *
 * End-to-end wizard coverage for the client identity path: the picker commits a
 * canonical client id, the id survives step navigation into Review & Create,
 * the review resolves and shows the client, and the id reaches the draft
 * submission payload unchanged.
 *
 * The lower-level picker/date seams are mocked; the real ContractBasicsStep,
 * ReviewContractStep, and ContractWizard are exercised.
 */
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, opts?: string | { defaultValue?: string }) => {
    if (typeof opts === 'string') return opts;
    return typeof opts?.defaultValue === 'string' ? opts.defaultValue : key;
  };
  const translation = { t };
  const formatters = {
    formatDate: (value: unknown) => String(value),
    formatCurrency: (value: number) => `$${value}`,
    formatNumber: (value: unknown) => String(value),
    formatRelativeTime: (value: unknown) => String(value),
  };
  return {
    useTranslation: () => translation,
    useOptionalI18n: () => ({ locale: 'en' }),
    useFormatters: () => formatters,
  };
});

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: { isOpen: boolean; children: React.ReactNode; footer?: React.ReactNode }) =>
    isOpen ? (
      <div data-testid="dialog">
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardProgress', () => ({
  WizardProgress: ({ currentStep }: { currentStep: number }) => (
    <div data-testid="wizard-progress" data-current-step={String(currentStep)} />
  ),
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardNavigation', () => ({
  WizardNavigation: ({
    onNext,
    onSaveDraft,
    onFinish,
  }: {
    onNext: () => void;
    onSaveDraft: () => void;
    onFinish: () => void;
  }) => (
    <div>
      <button type="button" onClick={onNext}>
        Next
      </button>
      <button type="button" onClick={onSaveDraft}>
        Save Draft
      </button>
      <button type="button" onClick={onFinish}>
        Finish
      </button>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value?: Date;
    onChange: (date: Date | undefined) => void;
  }) => (
    <input
      id={id}
      value={value ? value.toISOString().slice(0, 10) : ''}
      onChange={(event) => onChange(new Date(event.target.value))}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({
    onSelect,
    selectedClientId,
  }: {
    onSelect: (id: string | null) => void;
    selectedClientId: string | null;
  }) => (
    <button
      type="button"
      data-testid="client-picker-trigger"
      data-selected={selectedClientId ?? ''}
      onClick={() => onSelect('client-cool')}
    >
      pick client
    </button>
  ),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({ renderQuickAddClient: () => null }),
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useFormatBillingFrequency: () => (value: string) => value,
}));

vi.mock('@alga-psa/billing/actions/contractWizardActions', () => ({
  createClientContractFromWizard: vi.fn(),
  listContractTemplatesForWizard: vi.fn(async () => []),
  getContractTemplateSnapshotForClientWizard: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: vi.fn(async () => ({
    defaultRenewalMode: 'manual',
    defaultNoticePeriodDays: 30,
    defaultCurrencyCode: 'USD',
  })),
}));

const billingClients = vi.hoisted(() => ({
  getAllClientsForBilling: vi.fn(),
  getClientByIdForBilling: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getAllClientsForBilling: billingClients.getAllClientsForBilling,
  getClientByIdForBilling: billingClients.getClientByIdForBilling,
}));

describe('ContractWizard client identity', () => {
  let ContractWizard: typeof import('../src/components/billing-dashboard/contracts/ContractWizard')['ContractWizard'];

  beforeAll(async () => {
    ({ ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard'));
  }, 60_000);

  beforeEach(() => {
    document.body.removeAttribute('data-scroll-locked');
    document.body.removeAttribute('style');
    cleanup();
    vi.clearAllMocks();
    billingClients.getAllClientsForBilling.mockResolvedValue([
      { client_id: 'client-cool', client_name: 'Cool Cars', default_currency_code: 'USD' },
    ]);
    billingClients.getClientByIdForBilling.mockResolvedValue({ client_name: 'Cool Cars' });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('carries the selected client through navigation into review and submission', async () => {
    const { createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions');
    (createClientContractFromWizard as any).mockResolvedValue({ contract_id: 'contract-1' });

    render(<ContractWizard open={true} onOpenChange={vi.fn()} />);

    const user = userEvent.setup();
    const picker = await screen.findByTestId('client-picker-trigger');
    expect(picker).toHaveAttribute('data-selected', '');

    await act(async () => {
      await user.click(picker);
    });

    // The picker commit reaches wizard state as the canonical id.
    await waitFor(() => {
      expect(screen.getByTestId('client-picker-trigger')).toHaveAttribute('data-selected', 'client-cool');
    });

    const contractName = document.getElementById('contract_name') as HTMLInputElement;
    const startDate = document.getElementById('start-date') as HTMLInputElement;
    fireEvent.change(contractName, { target: { value: 'Cool Cars Support' } });
    fireEvent.change(startDate, { target: { value: '2026-09-01' } });

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await user.click(screen.getByText('Next'));
      });
    }

    // Review & Create projects the chosen client name from the canonical id.
    expect(await screen.findByText('Cool Cars')).toBeInTheDocument();
    expect(screen.queryByText('Not selected')).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByText('Save Draft'));
    });

    await waitFor(() => {
      expect(createClientContractFromWizard).toHaveBeenCalledTimes(1);
    });

    const [submission, options] = (createClientContractFromWizard as any).mock.calls[0];
    expect(submission.client_id).toBe('client-cool');
    expect(options).toEqual({ isDraft: true });
  });

  it('never projects the unselected fallback for a chosen client while the review lookup is pending', async () => {
    billingClients.getClientByIdForBilling.mockReturnValue(new Promise(() => {}));
    const { createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions');
    (createClientContractFromWizard as any).mockResolvedValue({ contract_id: 'contract-2' });

    render(<ContractWizard open={true} onOpenChange={vi.fn()} />);

    const user = userEvent.setup();
    await act(async () => {
      await user.click(await screen.findByTestId('client-picker-trigger'));
    });

    const contractName = document.getElementById('contract_name') as HTMLInputElement;
    const startDate = document.getElementById('start-date') as HTMLInputElement;
    fireEvent.change(contractName, { target: { value: 'Cool Cars Support' } });
    fireEvent.change(startDate, { target: { value: '2026-09-01' } });

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await user.click(screen.getByText('Next'));
      });
    }

    // The canonical id stands in until the name resolves; "Not selected" must
    // never describe a client the author has chosen.
    expect(await screen.findByText('client-cool')).toBeInTheDocument();
    expect(screen.queryByText('Not selected')).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByText('Save Draft'));
    });

    await waitFor(() => {
      expect(createClientContractFromWizard).toHaveBeenCalledTimes(1);
    });

    const [submission] = (createClientContractFromWizard as any).mock.calls[0];
    expect(submission.client_id).toBe('client-cool');
  });
});
