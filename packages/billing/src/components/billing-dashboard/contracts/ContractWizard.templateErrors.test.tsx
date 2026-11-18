/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  createClientContractFromWizard: vi.fn(),
  getView: vi.fn(),
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@product/billing/entry', () => ({ ContractDraftSimulator: () => null }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
    if (!fallback) return key;
    if (typeof fallback === 'string') return fallback;
    const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
    return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
  };
  return {
    useOptionalI18n: () => null,
    useTranslation: () => ({ t }),
    useFormatters: () => ({
      locale: 'en-US',
      formatCurrency: (value: number, code: string) => `${code} ${value.toFixed(2)}`,
    }),
  };
});

vi.mock('@alga-psa/billing/actions/contractWizardActions', () => ({
  createClientContractFromWizard: mocks.createClientContractFromWizard,
  saveClientContractDraft: vi.fn(),
  listContractTemplatesForWizard: vi.fn().mockResolvedValue([]),
  getContractTemplateLinesForClientWizard: mocks.getView,
}));
vi.mock('@alga-psa/billing/actions/contractWizardActionErrors', () => ({
  isRecurringChangeConfirmation: () => false,
}));
vi.mock('@alga-psa/billing/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: vi.fn().mockResolvedValue({}),
}));
vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientByIdForBilling: vi.fn().mockResolvedValue(null),
}));

vi.mock('./wizard-steps/ContractBasicsStep', () => ({ ContractBasicsStep: () => <div>basics</div> }));
vi.mock('./wizard-steps/FixedFeeServicesStep', () => ({ FixedFeeServicesStep: () => null }));
vi.mock('./wizard-steps/ProductsStep', () => ({ ProductsStep: () => null }));
vi.mock('./wizard-steps/HourlyServicesStep', () => ({ HourlyServicesStep: () => null }));
vi.mock('./wizard-steps/UsageBasedServicesStep', () => ({ UsageBasedServicesStep: () => null }));
vi.mock('./wizard-steps/ReviewContractStep', () => ({ ReviewContractStep: () => null }));
vi.mock('./wizard-steps/ContractCreatedConfirmation', () => ({ ContractCreatedConfirmation: () => null }));
vi.mock('./wizard-steps/TemplateLinesStep', () => ({
  TemplateLinesReview: () => null,
  TemplateLinesStep: ({ view, edits, onChange }: any) => {
    const lineId = view?.lines[0]?.template_line_id;
    return (
      <div>
        <button onClick={() => onChange([{ template_line_id: lineId, services: [{ service_id: 's1', rate: 15000 }] }])}>
          fill-rate
        </button>
        <button onClick={() => onChange([])}>clear-rate</button>
        <span data-testid="edit-count">{edits.length}</span>
      </div>
    );
  },
}));

import { ContractWizard } from './ContractWizard';

const view: any = {
  template_id: 't1',
  currency_code: 'EUR',
  template_currency: 'USD',
  amount_source: 'none',
  can_save_template_amounts: true,
  contract_name: 'Template contract',
  lines: [
    {
      template_line_id: 'l1',
      line_name: 'Support',
      line_type: 'Hourly',
      billing_frequency: 'monthly',
      bucket_pool_count: 0,
      base_rate: { slot_key: 'b', template_amount: null, amount: null, catalog_amount: null, required: false },
      overtime_rate: { slot_key: 'o', template_amount: null, amount: null, catalog_amount: null, required: false },
      bucket_pools: [],
      services: [
        {
          service_id: 's1',
          service_name: 'Helpdesk',
          quantity: 1,
          rate: { slot_key: 'a', template_amount: 10000, amount: null, catalog_amount: null, required: true },
          overtime_rate: { slot_key: 'mo', template_amount: null, amount: null, catalog_amount: null, required: false },
          bucket_overage_rate: { slot_key: 'bo', template_amount: null, amount: null, catalog_amount: null, required: false },
        },
      ],
    },
  ],
};

const editing: any = {
  client_id: 'c1',
  contract_name: 'Draft',
  template_id: 't1',
  billing_frequency: 'monthly',
  start_date: '2026-01-01',
  currency_code: 'EUR',
  fixed_lines: [],
  products: [],
  hourly_services: [],
  usage_services: [],
};

const MISSING = /Cannot create contract in EUR\. The following amounts have no EUR value: .*Helpdesk/;

describe('ContractWizard template mode', () => {
  beforeEach(() => {
    view.lines[0].template_line_id = 'l1';
    mocks.getView.mockResolvedValue(view);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function openAtTemplateLines() {
    render(<ContractWizard open onOpenChange={() => {}} editingContract={editing} />);
    await waitFor(() => expect(mocks.getView).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('fill-rate');
  }

  it('disables Skip on Template Lines while an amount is missing and re-enables it once filled', async () => {
    await openAtTemplateLines();
    // WizardNavigation hides Skip while it is disabled.
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    fireEvent.click(screen.getByText('fill-rate'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled());
  });

  it('shows the keyed error on the visible step and does not create when Finish is hit with a missing amount', async () => {
    await openAtTemplateLines();
    fireEvent.click(screen.getByText('fill-rate'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: 'Finish Setup' });

    // A later view refresh no longer matches the entered edit, so the amount is missing again.
    view.lines[0].template_line_id = 'l2';

    fireEvent.click(await screen.findByRole('button', { name: 'Finish Setup' }));
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(mocks.createClientContractFromWizard).not.toHaveBeenCalled();
  });
});
