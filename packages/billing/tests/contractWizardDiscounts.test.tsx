/**
 * @vitest-environment jsdom
 *
 * Wizard coverage for contract-wide discounts authored during creation: the
 * review step accepts them, Finish Setup submits them, the draft simulator is
 * handed the same drafts it prices, and Save as Draft (which cannot hold
 * standing terms) asks before dropping them.
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

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ id, isOpen, onClose, onConfirm, title, message, confirmLabel, cancelLabel }: any) =>
    isOpen ? (
      <div data-testid={id}>
        <div>{title}</div>
        <div>{message}</div>
        <button type="button" onClick={() => onConfirm()}>{confirmLabel}</button>
        <button type="button" onClick={onClose}>{cancelLabel}</button>
      </div>
    ) : null,
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
      <button type="button" onClick={onNext}>Next</button>
      <button type="button" onClick={onSaveDraft}>Save Draft</button>
      <button type="button" onClick={onFinish}>Finish</button>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id, value, onChange }: { id?: string; value?: Date; onChange: (date: Date | undefined) => void }) => (
    <input
      id={id}
      value={value ? value.toISOString().slice(0, 10) : ''}
      onChange={(event) => onChange(new Date(event.target.value))}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: ({ onSelect, selectedClientId }: { onSelect: (id: string | null) => void; selectedClientId: string | null }) => (
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

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/billing/hooks/useBillingEnumOptions')>()),
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

// The simulator is EE-only and loaded dynamically; record the draft it is
// handed so the wizard's promise ("visible in the simulator") is asserted.
const simulator = vi.hoisted(() => ({ drafts: [] as any[] }));
vi.mock('next/dynamic', () => ({
  default: () => (props: any) => {
    simulator.drafts.push(props.draft);
    return <div data-testid="draft-simulator" />;
  },
}));

describe('ContractWizard contract-wide discounts', () => {
  let ContractWizard: typeof import('../src/components/billing-dashboard/contracts/ContractWizard')['ContractWizard'];
  let create: any;

  beforeAll(async () => {
    ({ ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard'));
    ({ createClientContractFromWizard: create } = await import('@alga-psa/billing/actions/contractWizardActions') as any);
  }, 60_000);

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    simulator.drafts.length = 0;
    billingClients.getAllClientsForBilling.mockResolvedValue([
      { client_id: 'client-cool', client_name: 'Cool Cars', default_currency_code: 'USD' },
    ]);
    billingClients.getClientByIdForBilling.mockResolvedValue({ client_name: 'Cool Cars' });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  const editing = (): any => ({
    client_id: 'client-cool',
    contract_name: 'Cool Cars Support',
    start_date: '2026-09-01',
    billing_frequency: 'monthly',
    currency_code: 'USD',
    fixed_lines: [
      {
        line_key: 'a',
        contract_line_name: 'Line a',
        enable_proration: true,
        base_rate: 100000,
        services: [{ service_id: 's1', service_name: 'Service s1', quantity: 1, pricing_basis: 'bundle' }],
      },
    ],
    product_services: [],
    hourly_services: [],
    usage_services: [],
    enable_proration: true,
    cadence_owner: 'client',
    billing_timing: 'arrears',
  });

  const goToReview = async (user: ReturnType<typeof userEvent.setup>) => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await user.click(screen.getByText('Next'));
      });
    }
  };

  const click = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    await act(async () => {
      await user.click(screen.getByText(text));
    });
  };

  const addDiscount = async (user: ReturnType<typeof userEvent.setup>, name: string, percent: string) => {
    fireEvent.change(document.getElementById('wizard-discount-name') as HTMLInputElement, {
      target: { value: name },
    });
    fireEvent.change(document.getElementById('wizard-discount-value') as HTMLInputElement, {
      target: { value: percent },
    });
    fireEvent.change(document.getElementById('wizard-discount-start-date') as HTMLInputElement, {
      target: { value: '2026-09-01' },
    });
    await click(user, 'Add Discount');
  };

  it('submits a discount authored on the review step when setup is finished', async () => {
    create.mockResolvedValue({ contract_id: 'contract-1' });
    render(<ContractWizard open onOpenChange={vi.fn()} editingContract={editing()} />);
    const user = userEvent.setup();
    await goToReview(user);

    await addDiscount(user, 'Loyalty', '10');
    expect(await screen.findByText(/Loyalty · 10%/)).toBeInTheDocument();

    await click(user, 'Finish');
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    const [submission, options] = create.mock.calls[0];
    expect(options).toBeUndefined();
    expect(submission.discounts).toHaveLength(1);
    expect(submission.discounts[0]).toMatchObject({
      discount_name: 'Loyalty',
      discount_type: 'percentage',
      value: 10,
      start_date: '2026-09-01',
      end_date: null,
    });
  });

  it('hands the authored discounts to the draft simulator', async () => {
    render(<ContractWizard open onOpenChange={vi.fn()} editingContract={editing()} />);
    const user = userEvent.setup();
    await goToReview(user);
    await addDiscount(user, 'Loyalty', '10');

    await waitFor(() => {
      const latest = simulator.drafts[simulator.drafts.length - 1];
      expect(latest?.discounts).toMatchObject([{ discount_name: 'Loyalty', value: 10 }]);
    });
  });

  // The simulator reloads its scenario whenever this draft changes, which
  // discards nothing only because the draft is tied to wizard state: a bare
  // re-render must hand back the very same draft.
  it('hands the simulator the same draft when the draft itself did not change', async () => {
    const editingContract = editing();
    const { rerender } = render(
      <ContractWizard open onOpenChange={vi.fn()} editingContract={editingContract} />,
    );
    const user = userEvent.setup();
    await goToReview(user);
    await addDiscount(user, 'Loyalty', '10');

    const handed = simulator.drafts[simulator.drafts.length - 1];
    const rendersBefore = simulator.drafts.length;
    await act(async () => {
      rerender(<ContractWizard open onOpenChange={vi.fn()} editingContract={editingContract} />);
    });

    expect(simulator.drafts.length).toBeGreaterThan(rendersBefore);
    expect(simulator.drafts[simulator.drafts.length - 1]).toBe(handed);
  });

  it('refuses a discount the authoring rules reject instead of submitting it', async () => {
    render(<ContractWizard open onOpenChange={vi.fn()} editingContract={editing()} />);
    const user = userEvent.setup();
    await goToReview(user);

    await addDiscount(user, 'Too much', '120');

    expect(
      await screen.findByText('Percentage discounts must be greater than 0 and at most 100.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Too much · 120%/)).not.toBeInTheDocument();
  });

  it('asks before Save as Draft drops discounts a draft cannot hold', async () => {
    create.mockResolvedValue({ contract_id: 'contract-1' });
    render(<ContractWizard open onOpenChange={vi.fn()} editingContract={editing()} />);
    const user = userEvent.setup();
    await goToReview(user);
    await addDiscount(user, 'Loyalty', '10');

    await click(user, 'Save Draft');
    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByTestId('contract-wizard-draft-discounts')).toBeInTheDocument();

    await click(user, 'Save draft anyway');
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    const [submission, options] = create.mock.calls[0];
    expect(options).toEqual({ isDraft: true });
    expect(submission.discounts).toBeUndefined();
  });

  it('saves a draft without asking when no discount was authored', async () => {
    create.mockResolvedValue({ contract_id: 'contract-1' });
    render(<ContractWizard open onOpenChange={vi.fn()} editingContract={editing()} />);
    const user = userEvent.setup();
    await goToReview(user);

    await click(user, 'Save Draft');
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('contract-wizard-draft-discounts')).not.toBeInTheDocument();
  });
});
