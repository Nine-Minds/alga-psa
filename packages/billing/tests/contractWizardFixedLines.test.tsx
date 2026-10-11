/**
 * @vitest-environment jsdom
 *
 * Wizard coverage for per-line fixed lines: submission carries `fixed_lines`,
 * per-line base-rate validation, service-less lines block Finish but not Save
 * Draft, and the recurring-total confirmation round trip.
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


const line = (key: string, rate: number | null, services: any[]) => ({
  line_key: key,
  contract_line_name: `Line ${key}`,
  enable_proration: true,
  base_rate: rate,
  services,
});
const svc = (id: string) => ({
  service_id: id,
  service_name: `Service ${id}`,
  quantity: 1,
  pricing_basis: 'bundle' as const,
});

describe('ContractWizard fixed lines', () => {
  let ContractWizard: typeof import('../src/components/billing-dashboard/contracts/ContractWizard')['ContractWizard'];
  let create: any;

  beforeAll(async () => {
    ({ ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard'));
    ({ createClientContractFromWizard: create } = await import('@alga-psa/billing/actions/contractWizardActions') as any);
  }, 60_000);

  beforeEach(() => {
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

  const editing = (fixed_lines: any[]): any => ({
    client_id: 'client-cool',
    contract_name: 'Cool Cars Support',
    start_date: '2026-09-01',
    billing_frequency: 'monthly',
    currency_code: 'USD',
    fixed_lines,
    product_services: [],
    hourly_services: [],
    usage_services: [],
    enable_proration: true,
    cadence_owner: 'client',
    billing_timing: 'arrears',
    contract_id: 'contract-1',
    is_draft: true,
  });

  const goTo = async (user: ReturnType<typeof userEvent.setup>, nexts: number) => {
    for (let i = 0; i < nexts; i += 1) {
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

  it('submits one entry per fixed line, each with its own base rate', async () => {
    create.mockResolvedValue({ contract_id: 'contract-1' });
    render(
      <ContractWizard
        open
        onOpenChange={vi.fn()}
        editingContract={editing([line('a', 100000, [svc('s1')]), line('b', 250000, [svc('s2')])])}
      />,
    );
    const user = userEvent.setup();
    await goTo(user, 5);
    await click(user, 'Save Draft');
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    const [submission] = create.mock.calls[0];
    expect(submission.fixed_lines).toHaveLength(2);
    expect(submission.fixed_lines.map((l: any) => l.base_rate)).toEqual([100000, 250000]);
    expect(submission.fixed_lines.map((l: any) => l.services[0].service_id)).toEqual(['s1', 's2']);
    expect(submission.fixed_services).toBeUndefined();
    expect(submission.fixed_base_rate).toBeUndefined();
  });

  it('requires a base rate on a line that has a bundle-priced service', async () => {
    render(
      <ContractWizard
        open
        onOpenChange={vi.fn()}
        editingContract={editing([line('a', 100000, [svc('s1')]), line('b', null, [svc('s2')])])}
      />,
    );
    const user = userEvent.setup();
    await goTo(user, 2);
    // Step 1 (fixed fee) must not advance past the line with no base rate.
    expect(screen.getByTestId('wizard-progress')).toHaveAttribute('data-current-step', '1');
  });

  it('blocks Finish for a service-less line but still lets Save Draft through', async () => {
    create.mockResolvedValue({ contract_id: 'contract-1' });
    render(
      <ContractWizard
        open
        onOpenChange={vi.fn()}
        editingContract={editing([line('a', 100000, [svc('s1')]), line('custom', 40000, [])])}
      />,
    );
    const user = userEvent.setup();
    await goTo(user, 5);

    await click(user, 'Finish');
    expect(create).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/has a recurring amount but no service to bill it on/),
    ).toBeInTheDocument();

    await click(user, 'Save Draft');
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const [submission, options] = create.mock.calls[0];
    expect(options).toEqual({ isDraft: true });
    expect(submission.fixed_lines.map((l: any) => l.base_rate)).toEqual([100000, 40000]);
  });

  it('confirmation_required opens the dialog; confirming resubmits with the baseline ack', async () => {
    create
      .mockResolvedValueOnce({
        confirmation_required: 'recurring_total_change',
        baseline_monthly_cents: 100000,
        resulting_monthly_cents: 150000,
      })
      .mockResolvedValueOnce({ contract_id: 'contract-1' });
    render(
      <ContractWizard
        open
        onOpenChange={vi.fn()}
        editingContract={editing([line('a', 150000, [svc('s1')])])}
      />,
    );
    const user = userEvent.setup();
    await goTo(user, 5);
    await click(user, 'Save Draft');

    expect(await screen.findByText('Confirm recurring total change')).toBeInTheDocument();
    expect(screen.getByText(/estimated monthly recurring value from/)).toBeInTheDocument();
    expect(create.mock.calls[0][0].recurring_change_ack).toBeUndefined();

    await click(user, 'Confirm and continue');
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0].recurring_change_ack).toEqual({ baseline_monthly_cents: 100000 });
  });

  it('cancelling the confirmation does not resubmit', async () => {
    create.mockResolvedValueOnce({
      confirmation_required: 'recurring_total_change',
      baseline_monthly_cents: 100000,
      resulting_monthly_cents: 150000,
    });
    render(
      <ContractWizard open onOpenChange={vi.fn()} editingContract={editing([line('a', 150000, [svc('s1')])])} />,
    );
    const user = userEvent.setup();
    await goTo(user, 5);
    await click(user, 'Save Draft');
    await screen.findByText('Go back');
    await click(user, 'Go back');
    expect(screen.queryByText('Confirm recurring total change')).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
