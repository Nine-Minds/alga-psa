/**
 * @vitest-environment jsdom
 *
 * Leaving the Team Members step used to create an account for every filled-in
 * row that was not already created, including people who had only been sent an
 * email invitation: they got a login with a fixed default password and their
 * own invitation then failed.
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
  addTeamMembers: vi.fn(() => Promise.resolve({ success: true, data: { created: ['pat@example.test'] } })),
}));

vi.mock('../../../../../packages/onboarding/src/actions', () => ({
  saveClientInfo: vi.fn(),
  addTeamMembers: mocks.addTeamMembers,
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
  mocks.addTeamMembers.mockClear();
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

const ivy = { firstName: 'Ivy', lastName: 'Invite', email: 'ivy@example.test', role: 'Technician', password: '', inviteMode: 'email' as const };
const pat = { firstName: 'Pat', lastName: 'Password', email: 'pat@example.test', role: 'Technician', password: 'NineMinds1234!', inviteMode: 'password' as const };

describe('OnboardingWizard team members step', () => {
  it('does not create accounts for members who were invited by email', async () => {
    const user = userEvent.setup();
    renderWizard({ currentStep: 1, teamMembers: [ivy], invitedTeamMemberEmails: [ivy.email] } as Partial<WizardData>);
    await user.click(screen.getByTestId('next-button'));
    await waitFor(() => expect(screen.getByText('AddClientStep')).toBeInTheDocument());
    expect(mocks.addTeamMembers).not.toHaveBeenCalled();
  });

  it('stops on an email invite that was never sent instead of creating an account', async () => {
    const user = userEvent.setup();
    renderWizard({ currentStep: 1, teamMembers: [ivy] } as Partial<WizardData>);
    await user.click(screen.getByTestId('next-button'));
    expect(await screen.findByText(/Send the invitation for each team member/)).toBeInTheDocument();
    expect(screen.getByText('TeamMembersStep')).toBeInTheDocument();
    expect(mocks.addTeamMembers).not.toHaveBeenCalled();
  });

  it('still creates unsaved members who were given a password', async () => {
    const user = userEvent.setup();
    renderWizard({ currentStep: 1, teamMembers: [pat, ivy], invitedTeamMemberEmails: [ivy.email] } as Partial<WizardData>);
    await user.click(screen.getByTestId('next-button'));
    await waitFor(() => expect(mocks.addTeamMembers).toHaveBeenCalledWith([pat]));
  });
});
