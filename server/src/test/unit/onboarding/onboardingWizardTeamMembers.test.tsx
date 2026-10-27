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
import { restoreTeamMemberProgress } from '../../../../../packages/onboarding/src/lib/restoreTeamMemberProgress';

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
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key)
      .replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? '')),
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
  TeamMembersStep: ({ data, updateData }: { data: WizardData; updateData: (d: Partial<WizardData>) => void }) => (
    <div>
      TeamMembersStep
      <button
        data-testid="report-saved"
        onClick={() => updateData({ createdTeamMemberEmails: [...(data.createdTeamMemberEmails ?? []), 'saved@example.test'] })}
      >
        report saved
      </button>
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

  it('does not advance silently when the members were created but progress was not saved', async () => {
    mocks.addTeamMembers.mockResolvedValue({ success: true, data: {
      created: ['new@example.test'], notCreated: [], progressError: 'server english',
    } });
    const user = userEvent.setup();
    await clickNextOnTeamStep({ teamMembers: [member('new@example.test')] });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/created, but setup could not save its progress: new@example.test/);
    expect(alert).not.toHaveTextContent('server english');
    expect(screen.getByTestId('current-step')).toHaveTextContent('1');
    expect(screen.getByTestId('created-emails')).toHaveTextContent('new@example.test');

    // The warning is not a dead end: Next continues without creating them again.
    await user.click(screen.getByTestId('next-button'));
    await waitFor(() => expect(screen.getByText('AddClientStep')).toBeInTheDocument());
    expect(mocks.addTeamMembers).toHaveBeenCalledTimes(1);
  });

  it('adds the progress warning to the not-created list in a partial batch', async () => {
    mocks.addTeamMembers.mockResolvedValue({ success: false, error: 'x', data: {
      created: ['ok@example.test'], progressError: 'server english',
      notCreated: [{ email: 'bad@example.test', reason: 'failed', error: 'Could not create user.' }],
    } });
    await clickNextOnTeamStep({ teamMembers: [member('ok@example.test'), member('bad@example.test')] });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('bad@example.test: Could not create user.');
    expect(alert).toHaveTextContent(/could not save its progress: ok@example.test/);
  });

  it('does not send a member whose email is only spaces', async () => {
    await clickNextOnTeamStep({ teamMembers: [member('   ')] });
    await waitFor(() => expect(screen.getByText('AddClientStep')).toBeInTheDocument());
    expect(mocks.addTeamMembers).not.toHaveBeenCalled();
  });

  it('treats a member restored from saved progress as created', async () => {
    const saved = { teamMembers: [{ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', role: 'Technician' }] };
    await clickNextOnTeamStep(restoreTeamMemberProgress(saved as Partial<WizardData>));

    await waitFor(() => expect(screen.getByText('AddClientStep')).toBeInTheDocument());
    expect(mocks.addTeamMembers).not.toHaveBeenCalled();
  });

  it('shows a resumed member as created on the team step', () => {
    const saved = { teamMembers: [{ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', role: 'Technician' }] };
    render(<OnboardingWizard fullPage initialData={{ currentStep: 1, ...restoreTeamMemberProgress(saved as Partial<WizardData>) }} onComplete={vi.fn()} />);
    expect(screen.getByTestId('created-emails')).toHaveTextContent('ada@example.test');
  });

  it('clears the team-step error once a member is saved from the step', async () => {
    mocks.addTeamMembers.mockResolvedValue({
      success: false,
      error: '1 team member(s) were not created',
      data: { created: [], notCreated: [{ email: 'taken@example.test', reason: 'exists', error: 'already exists' }] },
    });
    await clickNextOnTeamStep({ teamMembers: [member('taken@example.test')] });
    expect(await screen.findByRole('alert')).toHaveTextContent(/These team members were not created/);

    await userEvent.setup().click(screen.getByTestId('report-saved'));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('restoreTeamMemberProgress', () => {
  const saved = (email: string) => ({ firstName: 'A', lastName: 'B', email, role: 'Technician' });

  it('unions saved created emails with saved team members and de-duplicates', () => {
    const result = restoreTeamMemberProgress({
      teamMembers: [saved('a@x.test'), saved('b@x.test')],
      createdTeamMemberEmails: ['b@x.test', 'c@x.test'],
    } as Partial<WizardData>);
    expect(result.createdTeamMemberEmails).toEqual(['b@x.test', 'c@x.test', 'a@x.test']);
  });

  it('keeps saved created emails when there are no team members', () => {
    expect(restoreTeamMemberProgress({ createdTeamMemberEmails: ['a@x.test'] }).createdTeamMemberEmails).toEqual(['a@x.test']);
    expect(restoreTeamMemberProgress({}).createdTeamMemberEmails).toEqual([]);
  });

  it('ignores blank emails and leaves other fields alone', () => {
    const result = restoreTeamMemberProgress({ tenantName: 'T', teamMembers: [saved(''), saved('  '), saved('a@x.test')] } as Partial<WizardData>);
    expect(result.createdTeamMemberEmails).toEqual(['a@x.test']);
    expect(result.tenantName).toBe('T');
  });
  it('treats a re-typed address in another case as the member already created', async () => {
    await clickNextOnTeamStep({
      teamMembers: [member('dana@example.test')],
      createdTeamMemberEmails: ['Dana@Example.test'],
    });

    await waitFor(() => expect(screen.getByText('AddClientStep')).toBeInTheDocument());
    expect(mocks.addTeamMembers).not.toHaveBeenCalled();
  });

  it('restores saved emails that differ only in case as one created member', () => {
    const restored = restoreTeamMemberProgress({
      createdTeamMemberEmails: ['Dana@Example.test'],
      teamMembers: [{ firstName: 'Dana', lastName: 'D', email: 'dana@example.test', role: 'Technician' }],
    } as Partial<WizardData>);
    expect(restored.createdTeamMemberEmails).toEqual(['dana@example.test']);
  });
});
