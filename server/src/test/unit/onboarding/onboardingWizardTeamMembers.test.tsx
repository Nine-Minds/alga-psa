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

/**
 * The team step's Next: members already created or invited are never sent to
 * addTeamMembers, an unsent email invite stops the step, and members the batch
 * could not create are named with their reason while the step stays put.
 */
const mocks = vi.hoisted(() => ({
  addTeamMembers: vi.fn(),
}));

vi.mock('../../../../../packages/onboarding/src/actions', () => ({
  saveClientInfo: vi.fn(),
  addTeamMembers: mocks.addTeamMembers,
  createClient: vi.fn(),
  addClientContact: vi.fn(),
  setupBilling: vi.fn(),
  configureTicketing: vi.fn(),
  completeOnboarding: vi.fn(),
  validateOnboardingDefaults: vi.fn(),
  saveOnboardingStepPosition: vi.fn(() => Promise.resolve({ success: true })),
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
  WizardNavigation: ({ onNext }: { onNext: () => void }) => (
    <button data-testid="next-button" onClick={onNext}>Next</button>
  ),
}));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../../packages/onboarding/src/components/steps/ClientInfoStep', () => ({
  ClientInfoStep: () => <div>ClientInfoStep</div>,
}));
vi.mock('../../../../../packages/onboarding/src/components/steps/TeamMembersStep', () => ({
  TeamMembersStep: ({ data }: { data: WizardData }) => (
    <div>
      TeamMembersStep
      <span data-testid="created-emails">{(data.createdTeamMemberEmails ?? []).join(',')}</span>
    </div>
  ),
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
  mocks.addTeamMembers.mockReset();
});

const member = (email: string, inviteMode: 'email' | 'password' = 'password') => ({
  firstName: 'Team', lastName: 'Member', email, role: 'Technician', inviteMode, password: 'Temp-Pass-123!',
});

async function clickNextOnTeamStep(initialData: Partial<WizardData>) {
  const user = userEvent.setup();
  render(<OnboardingWizard fullPage initialData={{ currentStep: 1, ...initialData }} onComplete={vi.fn()} />);
  expect(screen.getByText('TeamMembersStep')).toBeInTheDocument();
  await user.click(screen.getByTestId('next-button'));
}

describe('OnboardingWizard team members step', () => {
  it('advances without creating members that were already created or invited', async () => {
    await clickNextOnTeamStep({
      teamMembers: [member('created@example.test'), member('invited@example.test', 'email')],
      createdTeamMemberEmails: ['created@example.test'],
      invitedTeamMemberEmails: ['invited@example.test'],
    });

    await waitFor(() => expect(screen.getByText('AddClientStep')).toBeInTheDocument());
    expect(mocks.addTeamMembers).not.toHaveBeenCalled();
  });

  it('sends only the new password members to addTeamMembers', async () => {
    mocks.addTeamMembers.mockResolvedValue({ success: true, data: { created: ['new@example.test'], notCreated: [] } });
    await clickNextOnTeamStep({
      teamMembers: [member('invited@example.test', 'email'), member('new@example.test')],
      invitedTeamMemberEmails: ['invited@example.test'],
    });

    await waitFor(() => expect(screen.getByText('AddClientStep')).toBeInTheDocument());
    expect(mocks.addTeamMembers).toHaveBeenCalledWith([member('new@example.test')]);
  });

  it('refuses to continue while an email invite has not been sent', async () => {
    await clickNextOnTeamStep({ teamMembers: [member('unsent@example.test', 'email')] });

    expect(await screen.findByRole('alert')).toHaveTextContent(/Send the invitation for each team member/);
    expect(screen.getByText('TeamMembersStep')).toBeInTheDocument();
    expect(mocks.addTeamMembers).not.toHaveBeenCalled();
  });

  it('names each member that was not created, keeps the created ones, and stays on the step', async () => {
    mocks.addTeamMembers.mockResolvedValue({
      success: false,
      error: '2 team member(s) were not created',
      data: {
        created: ['ok@example.test'],
        notCreated: [
          { email: 'full@example.test', reason: 'limit', error: "You've reached your MSP user license limit." },
          { email: 'taken@example.test', reason: 'exists', error: 'A user with this email address already exists' },
        ],
      },
    });
    await clickNextOnTeamStep({
      teamMembers: [member('ok@example.test'), member('full@example.test'), member('taken@example.test')],
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/These team members were not created/);
    expect(alert).toHaveTextContent("full@example.test: You've reached your MSP user license limit.");
    expect(alert).toHaveTextContent('taken@example.test: A user with this email address already exists');
    expect(alert).not.toHaveTextContent('ok@example.test');
    expect(screen.getByText('TeamMembersStep')).toBeInTheDocument();
    expect(screen.getByTestId('current-step')).toHaveTextContent('1');
    expect(screen.getByTestId('created-emails')).toHaveTextContent('ok@example.test');
  });
});
