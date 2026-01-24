/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
  WizardNavigation: ({ onNext, onBack }: { onNext: () => void; onBack: () => void }) => (
    <div>
      <button type="button" onClick={onBack}>
        Back
      </button>
      <button type="button" onClick={onNext}>
        Next
      </button>
    </div>
  ),
}));

vi.mock('../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep', () => ({
  ContractBasicsStep: ({ data }: { data: any }) => (
    <div data-testid="step-contract-basics" data-client-id={data.client_id ?? ''} />
  ),
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
  createClientContractFromWizard: vi.fn(),
  listContractTemplatesForWizard: vi.fn(async () => []),
  getContractTemplateSnapshotForClientWizard: vi.fn(),
}));

describe('ContractWizard resume behavior', () => {
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
});

