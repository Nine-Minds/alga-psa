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
  saveOnboardingStepPosition: vi.fn(() => Promise.resolve({ success: true })),
  createClient: vi.fn(() => Promise.resolve({ success: true, data: { clientId: 'client-1' } })),
}));

vi.mock('../../../../../packages/onboarding/src/actions', () => ({
  saveClientInfo: vi.fn(),
  addTeamMembers: vi.fn(),
  createClient: mocks.createClient,
  addClientContact: vi.fn(),
  setupBilling: vi.fn(),
  configureTicketing: vi.fn(),
  completeOnboarding: vi.fn(),
  validateOnboardingDefaults: vi.fn(),
  saveOnboardingStepPosition: mocks.saveOnboardingStepPosition,
}));

vi.mock('@alga-psa/tenancy/actions', () => ({
  updateTenantDefaultLocaleAction: vi.fn(),
}));

vi.mock('@alga-psa/core/i18n/config', () => ({
  isSupportedLocale: () => true,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key),
  }),
  useI18n: () => ({
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardProgress', () => ({
  WizardProgress: ({ currentStep, completedSteps }: { currentStep: number; completedSteps: Set<number> }) => (
    <div>
      <span data-testid="current-step">{currentStep}</span>
      <span data-testid="completed-steps">{[...completedSteps].sort().join(',')}</span>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardNavigation', () => ({
  WizardNavigation: ({ onNext, isNextDisabled }: { onNext: () => void; isNextDisabled: boolean }) => (
    <button data-testid="next-button" disabled={isNextDisabled} onClick={onNext}>
      Next
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../../packages/onboarding/src/components/steps/ClientInfoStep', () => ({
  ClientInfoStep: () => <div>ClientInfoStep</div>,
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
  mocks.saveOnboardingStepPosition.mockClear();
  mocks.createClient.mockClear();
});

const renderWizard = (initialData: Partial<WizardData> = {}) =>
  render(<OnboardingWizard fullPage initialData={initialData} onComplete={vi.fn()} />);

describe('OnboardingWizard step restore (refresh resilience)', () => {
  it('starts on step 0 when no step position was saved', () => {
    renderWizard();

    expect(screen.getByText('ClientInfoStep')).toBeInTheDocument();
    expect(screen.getByTestId('current-step')).toHaveTextContent('0');
    expect(screen.getByTestId('completed-steps')).toHaveTextContent('');
  });

  it('resumes on the saved step and marks earlier steps completed', () => {
    renderWizard({ currentStep: 2 });

    expect(screen.getByText('AddClientStep')).toBeInTheDocument();
    expect(screen.getByTestId('current-step')).toHaveTextContent('2');
    expect(screen.getByTestId('completed-steps')).toHaveTextContent('0,1');
  });

  it('clamps an out-of-range saved step to the last step', () => {
    renderWizard({ currentStep: 99 });

    expect(screen.getByText('TicketingConfigStep')).toBeInTheDocument();
    expect(screen.getByTestId('current-step')).toHaveTextContent('5');
  });

  it('ignores a non-numeric saved step', () => {
    renderWizard({ currentStep: 'billing' as unknown as number });

    expect(screen.getByText('ClientInfoStep')).toBeInTheDocument();
    expect(screen.getByTestId('current-step')).toHaveTextContent('0');
  });

  it('persists the step position on mount and after advancing', async () => {
    const user = userEvent.setup();
    renderWizard({ currentStep: 2, clientName: 'Acme Corp' });

    await waitFor(() => {
      expect(mocks.saveOnboardingStepPosition).toHaveBeenCalledWith(2);
    });

    await user.click(screen.getByTestId('next-button'));

    await waitFor(() => {
      expect(mocks.saveOnboardingStepPosition).toHaveBeenCalledWith(3);
    });
    expect(screen.getByText('ClientContactStep')).toBeInTheDocument();
  });
});
