/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="dialog">{children}</div> : null,
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardProgress', () => ({
  WizardProgress: ({ currentStep }: { currentStep: number }) => (
    <div data-testid="wizard-progress" data-current-step={String(currentStep)} />
  ),
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardNavigation', () => ({
  WizardNavigation: ({
    onNext,
    onBack,
    onSaveDraft,
  }: {
    onNext: () => void;
    onBack: () => void;
    onSaveDraft: () => void;
  }) => (
    <div>
      <button type="button" onClick={onBack}>
        Back
      </button>
      <button type="button" onClick={onNext}>
        Next
      </button>
      <button type="button" onClick={onSaveDraft}>
        Save Draft
      </button>
    </div>
  ),
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep', () => ({
  ContractBasicsStep: ({ data }: { data: any }) => (
    <div
      data-testid="step-contract-basics"
      data-client-id={data.client_id ?? ''}
      data-contract-name={data.contract_name ?? ''}
      data-start-date={data.start_date ?? ''}
      data-end-date={data.end_date ?? ''}
    />
  ),
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep', () => ({
  FixedFeeServicesStep: ({ data }: { data: any }) => (
    <div data-testid="step-fixed-fee" data-fixed-services-count={String((data.fixed_services ?? []).length)} />
  ),
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/ProductsStep', () => ({
  ProductsStep: ({ data }: { data: any }) => (
    <div data-testid="step-products" data-product-services-count={String((data.product_services ?? []).length)} />
  ),
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/HourlyServicesStep', () => ({
  HourlyServicesStep: ({ data }: { data: any }) => (
    <div data-testid="step-hourly" data-hourly-services-count={String((data.hourly_services ?? []).length)} />
  ),
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/UsageBasedServicesStep', () => ({
  UsageBasedServicesStep: ({ data }: { data: any }) => (
    <div data-testid="step-usage" data-usage-services-count={String((data.usage_services ?? []).length)} />
  ),
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep', () => ({
  ReviewContractStep: ({ data }: { data: any }) => (
    <div
      data-testid="step-review"
      data-contract-name={data.contract_name ?? ''}
      data-fixed-services-count={String((data.fixed_services ?? []).length)}
      data-product-services-count={String((data.product_services ?? []).length)}
      data-hourly-services-count={String((data.hourly_services ?? []).length)}
      data-usage-services-count={String((data.usage_services ?? []).length)}
    />
  ),
}));

vi.mock('@alga-psa/billing/actions/contractWizardActions', () => ({
  createClientContractFromWizard: vi.fn(),
  listContractTemplatesForWizard: vi.fn(async () => []),
  getContractTemplateSnapshotForClientWizard: vi.fn(),
}));

describe('ContractWizard resume behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts at Step 1 (Contract Basics) when opened (T033)', async () => {
    const { ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard');
    render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'contract-1',
          is_draft: true,
          client_id: 'client-1',
          contract_name: 'Draft Alpha',
          start_date: '2026-01-01',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_services: [],
          product_services: [],
          hourly_services: [],
          usage_services: [],
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('step-contract-basics')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('step-fixed-fee')).not.toBeInTheDocument();
  });

  it('step 1 shows pre-populated client selection from draft (T034)', async () => {
    const { ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard');
    render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'contract-1',
          is_draft: true,
          client_id: 'client-99',
          contract_name: 'Draft Alpha',
          start_date: '2026-01-01',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_services: [],
          product_services: [],
          hourly_services: [],
          usage_services: [],
        }}
      />,
    );

    const step = await screen.findByTestId('step-contract-basics');
    expect(step).toHaveAttribute('data-client-id', 'client-99');
  });

  it('step 1 shows pre-populated contract name from draft (T035)', async () => {
    const { ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard');
    render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'contract-1',
          is_draft: true,
          client_id: 'client-1',
          contract_name: 'Draft Name',
          start_date: '2026-01-01',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_services: [],
          product_services: [],
          hourly_services: [],
          usage_services: [],
        }}
      />,
    );

    const step = await screen.findByTestId('step-contract-basics');
    expect(step).toHaveAttribute('data-contract-name', 'Draft Name');
  });

  it('step 1 shows pre-populated dates from draft (T036)', async () => {
    const { ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard');
    render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'contract-1',
          is_draft: true,
          client_id: 'client-1',
          contract_name: 'Draft Alpha',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_services: [],
          product_services: [],
          hourly_services: [],
          usage_services: [],
        }}
      />,
    );

    const step = await screen.findByTestId('step-contract-basics');
    expect(step).toHaveAttribute('data-start-date', '2026-01-01');
    expect(step).toHaveAttribute('data-end-date', '2026-12-31');
  });

  it('step 2 (Fixed Fee) shows pre-populated services from draft (T037)', async () => {
    const { ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard');
    render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'contract-1',
          is_draft: true,
          client_id: 'client-1',
          contract_name: 'Draft Alpha',
          start_date: '2026-01-01',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_base_rate: 10000,
          fixed_services: [
            { service_id: 'svc-1', quantity: 1 },
            { service_id: 'svc-2', quantity: 2 },
          ],
          product_services: [],
          hourly_services: [],
          usage_services: [],
        }}
      />,
    );

    await screen.findByTestId('step-contract-basics');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByText('Next'));
    });

    const step = await screen.findByTestId('step-fixed-fee');
    expect(step).toHaveAttribute('data-fixed-services-count', '2');
  });

  it('step 3 (Products) shows pre-populated products from draft (T038)', async () => {
    const { ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard');
    render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'contract-1',
          is_draft: true,
          client_id: 'client-1',
          contract_name: 'Draft Alpha',
          start_date: '2026-01-01',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_services: [],
          product_services: [
            { service_id: 'prod-1', quantity: 1 },
            { service_id: 'prod-2', quantity: 2 },
          ],
          hourly_services: [],
          usage_services: [],
        }}
      />,
    );

    await screen.findByTestId('step-contract-basics');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByText('Next'));
    });
    await act(async () => {
      await user.click(screen.getByText('Next'));
    });

    const step = await screen.findByTestId('step-products');
    expect(step).toHaveAttribute('data-product-services-count', '2');
  });

  it('step 4 (Hourly) shows pre-populated hourly services from draft (T039)', async () => {
    const { ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard');
    render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'contract-1',
          is_draft: true,
          client_id: 'client-1',
          contract_name: 'Draft Alpha',
          start_date: '2026-01-01',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_services: [],
          product_services: [],
          hourly_services: [
            { service_id: 'hr-1' },
            { service_id: 'hr-2' },
          ],
          usage_services: [],
        }}
      />,
    );

    await screen.findByTestId('step-contract-basics');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByText('Next'));
    });
    await act(async () => {
      await user.click(screen.getByText('Next'));
    });
    await act(async () => {
      await user.click(screen.getByText('Next'));
    });

    const step = await screen.findByTestId('step-hourly');
    expect(step).toHaveAttribute('data-hourly-services-count', '2');
  });

  it('step 5 (Usage) shows pre-populated usage services from draft (T040)', async () => {
    const { ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard');
    render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'contract-1',
          is_draft: true,
          client_id: 'client-1',
          contract_name: 'Draft Alpha',
          start_date: '2026-01-01',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_services: [],
          product_services: [],
          hourly_services: [],
          usage_services: [
            { service_id: 'u-1' },
            { service_id: 'u-2' },
            { service_id: 'u-3' },
          ],
        }}
      />,
    );

    await screen.findByTestId('step-contract-basics');
    const user = userEvent.setup();
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await user.click(screen.getByText('Next'));
      });
    }

    const step = await screen.findByTestId('step-usage');
    expect(step).toHaveAttribute('data-usage-services-count', '3');
  });

  it('step 6 (Review) shows complete draft data for review (T041)', async () => {
    const { ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard');
    render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'contract-1',
          is_draft: true,
          client_id: 'client-1',
          contract_name: 'Draft Alpha',
          start_date: '2026-01-01',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_base_rate: 10000,
          fixed_services: [{ service_id: 'svc-1', quantity: 1 }],
          product_services: [{ service_id: 'prod-1', quantity: 1 }],
          hourly_services: [{ service_id: 'hr-1' }],
          usage_services: [{ service_id: 'u-1' }],
        }}
      />,
    );

    await screen.findByTestId('step-contract-basics');
    const user = userEvent.setup();
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await user.click(screen.getByText('Next'));
      });
    }

    const step = await screen.findByTestId('step-review');
    expect(step).toHaveAttribute('data-contract-name', 'Draft Alpha');
    expect(step).toHaveAttribute('data-fixed-services-count', '1');
    expect(step).toHaveAttribute('data-product-services-count', '1');
    expect(step).toHaveAttribute('data-hourly-services-count', '1');
    expect(step).toHaveAttribute('data-usage-services-count', '1');
  });

  it('clicking Save Draft in resumed wizard updates existing draft (T042)', async () => {
    const { createClientContractFromWizard } = await import('@alga-psa/billing/actions/contractWizardActions');
    (createClientContractFromWizard as any).mockResolvedValue({ contract_id: 'contract-1' });

    const { ContractWizard } = await import('../src/components/billing-dashboard/contracts/ContractWizard');
    render(
      <ContractWizard
        open={true}
        onOpenChange={vi.fn()}
        editingContract={{
          contract_id: 'contract-1',
          is_draft: true,
          client_id: 'client-1',
          contract_name: 'Draft Alpha',
          start_date: '2026-01-01',
          billing_frequency: 'monthly',
          currency_code: 'USD',
          enable_proration: false,
          fixed_services: [],
          product_services: [],
          hourly_services: [],
          usage_services: [],
        }}
      />,
    );

    await screen.findByTestId('step-contract-basics');
    const user = userEvent.setup();
    await act(async () => {
      await user.click(screen.getByText('Save Draft'));
    });

    await waitFor(() => {
      expect(createClientContractFromWizard).toHaveBeenCalled();
    });

    const [submission, options] = (createClientContractFromWizard as any).mock.calls[0];
    expect(submission.contract_id).toBe('contract-1');
    expect(options).toEqual({ isDraft: true });
  });
});
