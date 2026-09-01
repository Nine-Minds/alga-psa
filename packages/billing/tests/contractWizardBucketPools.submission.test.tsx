// @vitest-environment jsdom
/**
 * ContractWizard bucket-authoring submission (behavioral).
 *
 * The pool payload is submitted and no conflicting legacy `bucket_overlay`
 * fields travel on any service.
 *
 * These tests drive the real ContractWizard submit path end to end
 * (buildSubmissionData -> createClientContractFromWizard) and assert on the
 * actual submission payload, not on render snapshots.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Stable t()/formatters so hooks that list `t` in effect dependencies do not
// re-run on every render (react-i18next's no-instance fallback returns an
// unstable t, which sends ContractWizard's mount effect into a render loop).
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, opts?: string | { defaultValue?: string }) => {
    if (typeof opts === 'string') return opts;
    return typeof opts?.defaultValue === 'string' ? opts.defaultValue : key;
  };
  const translation = { t };
  const formatters = {
    formatDate: (value: unknown) => String(value),
    formatCurrency: (value: number) => `$${value}`,
  };
  return {
    useTranslation: () => translation,
    useFormatters: () => formatters,
  };
});

const mocks = vi.hoisted(() => ({
  createClientContractFromWizard: vi.fn(),
}));

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
  WizardProgress: () => <div data-testid="wizard-progress" />,
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardNavigation', () => ({
  WizardNavigation: ({
    onSaveDraft,
    onFinish,
  }: {
    onSaveDraft: () => void;
    onFinish: () => void;
  }) => (
    <div>
      <button type="button" onClick={onSaveDraft}>
        Save Draft
      </button>
      <button type="button" onClick={onFinish}>
        Finish
      </button>
    </div>
  ),
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep', () => ({
  ContractBasicsStep: () => <div data-testid="step-contract-basics" />,
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep', () => ({
  FixedFeeServicesStep: () => <div data-testid="step-fixed-fee" />,
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/ProductsStep', () => ({
  ProductsStep: () => <div data-testid="step-products" />,
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/HourlyServicesStep', () => ({
  HourlyServicesStep: () => <div data-testid="step-hourly" />,
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/UsageBasedServicesStep', () => ({
  UsageBasedServicesStep: () => <div data-testid="step-usage" />,
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep', () => ({
  ReviewContractStep: () => <div data-testid="step-review" />,
}));

vi.mock('@alga-psa/billing/actions/contractWizardActions', () => ({
  createClientContractFromWizard: (...args: unknown[]) => mocks.createClientContractFromWizard(...args),
  listContractTemplatesForWizard: vi.fn(async () => []),
  getContractTemplateSnapshotForClientWizard: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/billingSettingsActions', () => ({
  getDefaultBillingSettings: vi.fn(async () => ({
    defaultRenewalMode: 'manual',
    defaultNoticePeriodDays: 30,
  })),
}));

vi.mock('@alga-psa/billing/actions/billingClientsActions', () => ({
  getClientByIdForBilling: vi.fn(),
}));

const LEGACY_HOURLY_SERVICE = {
  service_id: 'svc-1',
  service_name: 'Support',
  hourly_rate: 10000,
  bucket_overlay: {
    total_minutes: 600,
    overage_rate: 15000,
    allow_rollover: true,
    billing_period: 'monthly' as const,
  },
};

const POOL_DRAFT = {
  line_key: 'hourly' as const,
  bucket_name: 'Pool A',
  total_minutes: 1200,
  overage_rate: 15000,
  allow_rollover: true,
  covers_all_services: false,
  after_hours_multiplier: 1.5,
  business_hours_schedule_id: 'sch-1',
  members: [{ service_id: 'svc-1', burn_multiplier: 2 }],
};

describe('ContractWizard bucket-authoring submission', () => {
  let ContractWizard: typeof import('../src/components/billing-dashboard/contracts/ContractWizard')['ContractWizard'];

  beforeAll(async () => {
    ({ ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard'));
  }, 60_000);

  beforeEach(() => {
    document.body.removeAttribute('data-scroll-locked');
    document.body.removeAttribute('style');
    vi.clearAllMocks();
    mocks.createClientContractFromWizard.mockImplementation(async () => ({
      contract_id: 'draft-1',
      contract_line_ids: [],
    }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function renderWizard(extra?: Record<string, unknown>) {
    return render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'draft-1',
          is_draft: true,
          client_id: 'client-1',
          contract_name: 'Legacy contract',
          start_date: '2026-01-01',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_services: [],
          product_services: [],
          hourly_services: [LEGACY_HOURLY_SERVICE],
          usage_services: [],
          ...extra,
        }}
      />,
    );
  }

  async function submitDraft() {
    await screen.findByTestId('step-contract-basics');
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => {
      expect(mocks.createClientContractFromWizard).toHaveBeenCalled();
    });
    return mocks.createClientContractFromWizard.mock.calls[0][0];
  }

  it('submission carries the pool payload and strips conflicting legacy bucket_overlay fields', async () => {
    renderWizard({
      // Stale legacy overlay left in wizard state: the flag-on submit path must
      // not let it travel alongside the pool payload.
      hourly_services: [LEGACY_HOURLY_SERVICE],
      bucket_pools: [POOL_DRAFT],
    });
    const submission = await submitDraft();

    // Pool payload present and faithful.
    expect(submission.bucket_pools).toHaveLength(1);
    expect(submission.bucket_pools[0]).toMatchObject(POOL_DRAFT);
    // No conflicting legacy bucket fields on any submitted service.
    expect(submission.hourly_services).toHaveLength(1);
    expect(submission.hourly_services[0].bucket_overlay).toBeUndefined();
    expect(submission.hourly_services[0]).not.toHaveProperty('bucket_overlay');
  });
});
