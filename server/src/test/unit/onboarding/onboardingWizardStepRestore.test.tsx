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
  configureTicketing: vi.fn(() => Promise.resolve({ success: true })),
  completeOnboarding: vi.fn(() => Promise.resolve({ success: true })),
  validateOnboardingDefaults: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../../../../packages/onboarding/src/actions', () => ({
  saveClientInfo: vi.fn(),
  addTeamMembers: vi.fn(),
  createClient: mocks.createClient,
  addClientContact: vi.fn(),
  setupBilling: vi.fn(),
  configureTicketing: mocks.configureTicketing,
  completeOnboarding: mocks.completeOnboarding,
  validateOnboardingDefaults: mocks.validateOnboardingDefaults,
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
  WizardNavigation: ({
    currentStep,
    totalSteps,
    onNext,
    onFinish,
    isNextDisabled,
  }: {
    currentStep: number;
    totalSteps: number;
    onNext: () => void;
    onFinish: () => void;
    isNextDisabled: boolean;
  }) => currentStep === totalSteps - 1 ? (
    <button data-testid="finish-button" disabled={isNextDisabled} onClick={onFinish}>
      Finish
    </button>
  ) : (
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
  mocks.saveOnboardingStepPosition.mockReset().mockResolvedValue({ success: true });
  mocks.createClient.mockClear();
  mocks.configureTicketing.mockReset().mockResolvedValue({ success: true });
  mocks.completeOnboarding.mockReset().mockResolvedValue({ success: true });
  mocks.validateOnboardingDefaults.mockReset().mockResolvedValue({ success: true });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

  it('serializes step-position saves in navigation order', async () => {
    const firstSave = deferred<{ success: boolean }>();
    const secondSave = deferred<{ success: boolean }>();
    mocks.saveOnboardingStepPosition
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);

    const user = userEvent.setup();
    renderWizard({ currentStep: 2, clientName: 'Acme Corp' });

    await waitFor(() => expect(mocks.saveOnboardingStepPosition).toHaveBeenCalledWith(2));
    await user.click(screen.getByTestId('next-button'));
    expect(screen.getByText('ClientContactStep')).toBeInTheDocument();
    expect(mocks.saveOnboardingStepPosition).toHaveBeenCalledTimes(1);

    firstSave.resolve({ success: true });
    await waitFor(() => expect(mocks.saveOnboardingStepPosition).toHaveBeenNthCalledWith(2, 3));
    secondSave.resolve({ success: true });
  });

  it('contains a rejected position save and continues with the next queued save', async () => {
    const firstSave = deferred<{ success: boolean }>();
    const secondSave = deferred<{ success: boolean }>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.saveOnboardingStepPosition
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);

    const user = userEvent.setup();
    renderWizard({ currentStep: 2, clientName: 'Acme Corp' });
    await waitFor(() => expect(mocks.saveOnboardingStepPosition).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId('next-button'));

    firstSave.reject(new Error('position write failed'));
    await waitFor(() => expect(mocks.saveOnboardingStepPosition).toHaveBeenNthCalledWith(2, 3));
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to persist onboarding step position:',
      expect.any(Error)
    );
    secondSave.resolve({ success: true });
    consoleError.mockRestore();
  });

  it('drains the position queue before final validation and completion', async () => {
    const pendingSave = deferred<{ success: boolean }>();
    mocks.saveOnboardingStepPosition.mockImplementationOnce(() => pendingSave.promise);

    const user = userEvent.setup();
    renderWizard({
      currentStep: 5,
      boardName: 'Support',
      priorities: ['High'],
    });
    await waitFor(() => expect(mocks.saveOnboardingStepPosition).toHaveBeenCalledWith(5));
    await user.click(screen.getByTestId('finish-button'));

    expect(mocks.validateOnboardingDefaults).not.toHaveBeenCalled();
    expect(mocks.configureTicketing).not.toHaveBeenCalled();
    expect(mocks.completeOnboarding).not.toHaveBeenCalled();

    pendingSave.resolve({ success: true });
    await waitFor(() => expect(mocks.completeOnboarding).toHaveBeenCalledTimes(1));
    expect(mocks.validateOnboardingDefaults).toHaveBeenCalledTimes(1);
    expect(mocks.configureTicketing).toHaveBeenCalledTimes(1);
  });

  it('continues final completion after a queued position save rejects', async () => {
    const pendingSave = deferred<{ success: boolean }>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.saveOnboardingStepPosition.mockImplementationOnce(() => pendingSave.promise);

    const user = userEvent.setup();
    renderWizard({
      currentStep: 5,
      boardName: 'Support',
      priorities: ['High'],
    });
    await waitFor(() => expect(mocks.saveOnboardingStepPosition).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId('finish-button'));
    pendingSave.reject(new Error('position write failed'));

    await waitFor(() => expect(mocks.completeOnboarding).toHaveBeenCalledTimes(1));
    expect(mocks.saveOnboardingStepPosition).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
