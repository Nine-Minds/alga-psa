/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingWizard } from '../../../../../packages/onboarding/src/components/OnboardingWizard';
import type { WizardData } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  saveClientInfo: vi.fn(),
  saveOnboardingStepPosition: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../../../../packages/onboarding/src/actions', () => ({
  saveClientInfo: mocks.saveClientInfo,
  addTeamMembers: vi.fn(),
  createClient: vi.fn(),
  addClientContact: vi.fn(),
  setupBilling: vi.fn(),
  configureTicketing: vi.fn(),
  completeOnboarding: vi.fn(),
  validateOnboardingDefaults: vi.fn(() => Promise.resolve({ success: true })),
  saveOnboardingStepPosition: mocks.saveOnboardingStepPosition,
}));

vi.mock('@alga-psa/tenancy/actions', () => ({ updateTenantDefaultLocaleAction: vi.fn() }));
vi.mock('@alga-psa/core/i18n/config', () => ({ isSupportedLocale: () => true }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useI18n: () => ({ locale: 'en', setLocale: vi.fn() }),
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/onboarding/WizardProgress', () => ({
  WizardProgress: ({ currentStep }: { currentStep: number }) => <span data-testid="current-step">{currentStep}</span>,
}));
vi.mock('@alga-psa/ui/components/onboarding/WizardNavigation', () => ({
  WizardNavigation: ({
    onBack,
    onNext,
    isNextDisabled,
  }: {
    onBack: () => void;
    onNext: () => void;
    isNextDisabled: boolean;
  }) => (
    <div>
      <button data-testid="back-button" onClick={onBack}>Back</button>
      <button data-testid="next-button" disabled={isNextDisabled} onClick={onNext}>Next</button>
    </div>
  ),
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
// The step reports the flag it is given; ClientInfoStep.addressCopy.test covers the copy itself.
vi.mock('../../../../../packages/onboarding/src/components/steps/ClientInfoStep', () => ({
  ClientInfoStep: ({ data }: { data: Partial<WizardData> }) => (
    <div data-testid="client-info-step">prefilled={String(!!data.companyAddressPrefilled)}</div>
  ),
}));
vi.mock('../../../../../packages/onboarding/src/components/steps/TeamMembersStep', () => ({
  TeamMembersStep: () => <div>TeamMembersStep</div>,
}));
vi.mock('../../../../../packages/onboarding/src/components/steps/AddClientStep', () => ({
  AddClientStep: () => <div>AddClientStep</div>,
}));
vi.mock('../../../../../packages/onboarding/src/components/steps/ClientContactStep', () => ({
  ClientContactStep: () => <div>ClientContactStep</div>,
}));
vi.mock('../../../../../packages/onboarding/src/components/steps/BillingSetupStep', () => ({
  BillingSetupStep: () => <div>BillingSetupStep</div>,
}));
vi.mock('../../../../../packages/onboarding/src/components/steps/TicketingConfigStep', () => ({
  TicketingConfigStep: () => <div>TicketingConfigStep</div>,
}));

afterEach(cleanup);
beforeEach(() => {
  mocks.saveClientInfo.mockReset();
  mocks.saveOnboardingStepPosition.mockReset().mockResolvedValue({ success: true });
});

const stepOneReady: Partial<WizardData> = {
  firstName: 'Ada',
  lastName: 'Admin',
  tenantName: 'Northwind IT Services',
  email: 'ada@example.test',
  newPassword: 'Review-Pass-2026!',
  confirmPassword: 'Review-Pass-2026!',
  companyPostalCode: '98101',
  companyCountryCode: 'US',
  companyAddressPrefilled: true,
};

const renderWizard = (initialData: Partial<WizardData>) =>
  render(<OnboardingWizard fullPage initialData={initialData} onComplete={vi.fn()} />);

describe('OnboardingWizard company address prefill after saving step 1', () => {
  it('going Back after a successful save no longer reports the address as prefilled', async () => {
    mocks.saveClientInfo.mockResolvedValue({ success: true });
    renderWizard(stepOneReady);
    expect(screen.getByTestId('client-info-step')).toHaveTextContent('prefilled=true');

    await userEvent.click(screen.getByTestId('next-button'));
    await waitFor(() => expect(screen.getByText('TeamMembersStep')).toBeInTheDocument());
    expect(mocks.saveClientInfo).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId('back-button'));
    await waitFor(() => expect(screen.getByTestId('client-info-step')).toHaveTextContent('prefilled=false'));
  });

  it('keeps the prefill when the save fails, since nothing of the user was stored', async () => {
    mocks.saveClientInfo.mockResolvedValue({ success: false, error: 'Database unavailable' });
    renderWizard(stepOneReady);

    await userEvent.click(screen.getByTestId('next-button'));
    await waitFor(() => expect(screen.getByText('Database unavailable')).toBeInTheDocument());
    expect(screen.getByTestId('client-info-step')).toHaveTextContent('prefilled=true');
  });
});
