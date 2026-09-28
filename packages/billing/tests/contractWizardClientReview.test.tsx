// @vitest-environment jsdom
/**
 * Regression coverage for the contract-wizard client projection.
 *
 * The picker commits a single canonical client id into wizard state. The review
 * step resolves the display name from that id asynchronously, so it must never
 * render the "Not selected" fallback for a client the author has chosen — not
 * while the lookup is in flight, and not when it fails.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, opts?: string | { defaultValue?: string }) => {
    if (typeof opts === 'string') return opts;
    return typeof opts?.defaultValue === 'string' ? opts.defaultValue : key;
  };
  return {
    useTranslation: () => ({ t }),
    useOptionalI18n: () => ({ locale: 'en' }),
    useFormatters: () => ({
      formatDate: (value: unknown) => String(value),
      formatCurrency: (value: number) => `$${value}`,
      formatNumber: (value: unknown) => String(value),
      formatRelativeTime: (value: unknown) => String(value),
    }),
  };
});

const mocks = vi.hoisted(() => ({
  getAllClientsForBilling: vi.fn(),
  getClientByIdForBilling: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getAllClientsForBilling: mocks.getAllClientsForBilling,
  getClientByIdForBilling: mocks.getClientByIdForBilling,
}));

vi.mock('@alga-psa/billing/hooks/useBillingEnumOptions', () => ({
  useBillingFrequencyOptions: () => [{ value: 'monthly', label: 'Monthly' }],
  useFormatBillingFrequency: () => (value: string) => value,
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({ renderQuickAddClient: () => null }),
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

import type { ContractWizardData } from '../src/components/billing-dashboard/contracts/ContractWizard';
import { ContractBasicsStep } from '../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep';
import { ReviewContractStep } from '../src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep';

const buildData = (overrides: Partial<ContractWizardData> = {}): ContractWizardData => ({
  client_id: '',
  contract_name: 'Cool Cars Support',
  start_date: '2026-09-01',
  billing_frequency: 'monthly',
  currency_code: 'USD',
  enable_proration: true,
  fixed_services: [],
  product_services: [],
  hourly_services: [],
  usage_services: [],
  ...overrides,
});

describe('contract wizard client projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllClientsForBilling.mockResolvedValue([
      {
        client_id: 'client-cool',
        client_name: 'Cool Cars',
        default_currency_code: 'USD',
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it('commits the canonical client id when the picker selects a client', async () => {
    const updateData = vi.fn();

    render(
      <ContractBasicsStep
        data={buildData()}
        updateData={updateData}
        templates={[]}
        isLoadingTemplates={false}
        selectedTemplateId={null}
        onTemplateSelect={vi.fn()}
        isTemplateLoading={false}
        templateError={null}
      />,
    );

    await waitFor(() => expect(mocks.getAllClientsForBilling).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('client-picker-trigger'));

    expect(updateData).toHaveBeenCalledWith({
      client_id: 'client-cool',
      currency_code: 'USD',
    });
  });

  it('renders the chosen client name on review and never the unselected fallback', async () => {
    mocks.getClientByIdForBilling.mockResolvedValue({ client_name: 'Cool Cars' });

    render(<ReviewContractStep data={buildData({ client_id: 'client-cool' })} />);

    expect(await screen.findByText('Cool Cars')).toBeInTheDocument();
    expect(screen.queryByText('Not selected')).not.toBeInTheDocument();
  });

  it('shows the chosen client id, not the unselected fallback, while the name is unresolved', () => {
    mocks.getClientByIdForBilling.mockReturnValue(new Promise(() => {}));

    render(<ReviewContractStep data={buildData({ client_id: 'client-cool' })} />);

    expect(screen.queryByText('Not selected')).not.toBeInTheDocument();
    expect(screen.getByText('client-cool')).toBeInTheDocument();
  });

  it('falls back to the chosen client id when the name lookup rejects', async () => {
    mocks.getClientByIdForBilling.mockRejectedValue(new Error('offline'));

    render(<ReviewContractStep data={buildData({ client_id: 'client-cool' })} />);

    expect(await screen.findByText('client-cool')).toBeInTheDocument();
    expect(screen.queryByText('Not selected')).not.toBeInTheDocument();
  });

  it('reports Not selected only when no client has been chosen', () => {
    render(<ReviewContractStep data={buildData()} />);

    expect(screen.getAllByText('Not selected').length).toBeGreaterThan(0);
  });
});
