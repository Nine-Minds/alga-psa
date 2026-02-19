/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const createContractTemplateFromWizard = vi.fn(async () => ({ contract_id: 'template-1' }));
const checkTemplateNameExists = vi.fn(async () => false);

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? React.createElement('div', { 'data-testid': 'dialog' }, children) : null,
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardProgress', () => ({
  WizardProgress: ({ currentStep }: { currentStep: number }) =>
    React.createElement('div', {
      'data-testid': 'wizard-progress',
      'data-current-step': String(currentStep),
    }),
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardNavigation', () => ({
  WizardNavigation: ({
    onNext,
    onBack,
    onFinish,
  }: {
    onNext: () => void;
    onBack: () => void;
    onFinish: () => void;
  }) =>
    React.createElement(
      'div',
      {},
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: onBack,
        },
        'Back'
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: onNext,
        },
        'Next'
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: onFinish,
        },
        'Finish'
      )
    ),
}));

vi.mock('@alga-psa/billing/actions/contractWizardActions', () => ({
  createContractTemplateFromWizard: (...args: any[]) => createContractTemplateFromWizard(...args),
  checkTemplateNameExists: (...args: any[]) => checkTemplateNameExists(...args),
}));

vi.mock('../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateContractBasicsStep', () => ({
  TemplateContractBasicsStep: ({ updateData }: { updateData: (data: any) => void }) => {
    React.useEffect(() => {
      updateData({
        contract_name: 'Bucket-Enabled Template',
        billing_frequency: 'monthly',
      });
      // Intentionally initialize once per mount for test setup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement('div', { 'data-testid': 'step-basics' });
  },
}));

vi.mock('../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateFixedFeeServicesStep', () => ({
  TemplateFixedFeeServicesStep: () => React.createElement('div', { 'data-testid': 'step-fixed' }),
}));

vi.mock('../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateProductsStep', () => ({
  TemplateProductsStep: () => React.createElement('div', { 'data-testid': 'step-products' }),
}));

vi.mock('../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateHourlyServicesStep', () => ({
  TemplateHourlyServicesStep: ({ updateData }: { updateData: (data: any) => void }) => {
    React.useEffect(() => {
      updateData({
        hourly_services: [
          {
            service_id: 'svc-hourly-1',
            service_name: 'Hourly Service',
            bucket_overlay: {
              total_minutes: 120,
              overage_rate: 15000,
              allow_rollover: true,
              billing_period: 'monthly',
            },
          },
        ],
      });
      // Intentionally initialize once per mount for test setup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement('div', { 'data-testid': 'step-hourly' });
  },
}));

vi.mock('../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateUsageBasedServicesStep', () => ({
  TemplateUsageBasedServicesStep: ({ updateData }: { updateData: (data: any) => void }) => {
    React.useEffect(() => {
      updateData({
        usage_services: [
          {
            service_id: 'svc-usage-1',
            service_name: 'Usage Service',
            unit_of_measure: 'seat',
            bucket_overlay: {
              total_minutes: 45,
              overage_rate: 2200,
              allow_rollover: false,
              billing_period: 'weekly',
            },
          },
        ],
      });
      // Intentionally initialize once per mount for test setup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement('div', { 'data-testid': 'step-usage' });
  },
}));

vi.mock('../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateReviewContractStep', () => ({
  TemplateReviewContractStep: () => React.createElement('div', { 'data-testid': 'step-review' }),
}));

describe('TemplateWizard bucket overlays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createContractTemplateFromWizard.mockResolvedValue({ contract_id: 'template-1' });
    checkTemplateNameExists.mockResolvedValue(false);
  });

  it('submits hourly and usage bucket overlays from template wizard data', async () => {
    const { TemplateWizard } = await import(
      '../src/components/billing-dashboard/contracts/template-wizard/TemplateWizard'
    );
    const user = userEvent.setup();

    render(React.createElement(TemplateWizard, { open: true, onOpenChange: vi.fn(), onComplete: vi.fn() }));

    await screen.findByTestId('step-basics');

    await act(async () => {
      await user.click(screen.getByText('Next'));
    });
    await act(async () => {
      await user.click(screen.getByText('Next'));
    });
    await act(async () => {
      await user.click(screen.getByText('Next'));
    });
    await screen.findByTestId('step-hourly');

    await act(async () => {
      await user.click(screen.getByText('Next'));
    });
    await screen.findByTestId('step-usage');

    await act(async () => {
      await user.click(screen.getByText('Next'));
    });
    await screen.findByTestId('step-review');

    await act(async () => {
      await user.click(screen.getByText('Finish'));
    });

    await waitFor(() => {
      expect(createContractTemplateFromWizard).toHaveBeenCalledTimes(1);
    });

    const submitted = createContractTemplateFromWizard.mock.calls[0][0];
    expect(submitted.hourly_services?.[0]?.bucket_overlay).toEqual({
      total_minutes: 120,
      overage_rate: 15000,
      allow_rollover: true,
      billing_period: 'monthly',
    });
    expect(submitted.usage_services?.[0]?.bucket_overlay).toEqual({
      total_minutes: 45,
      overage_rate: 2200,
      allow_rollover: false,
      billing_period: 'weekly',
    });
  });
});
