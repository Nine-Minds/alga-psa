import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// The onboarding page is where saved wizard progress is turned back into
// wizard state. restoreTeamMemberProgress folds the saved teamMembers into
// createdTeamMemberEmails (older progress has only teamMembers) so a resumed
// wizard does not create or invite them again.

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  canRun: true,
  settings: null as any,
  wizardProps: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace, push: mocks.push }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('@/context/ProductContext', () => ({ useProduct: () => ({ productCode: 'psa' }) }));
vi.mock('@alga-psa/tenancy/actions', () => ({ getTenantSettings: vi.fn(async () => mocks.settings) }));
vi.mock('@alga-psa/onboarding/actions/onboarding-actions/onboardingActions', () => ({
  getWorkspaceSetupAccess: vi.fn(async () => ({ canRun: mocks.canRun })),
  getOnboardingInitialData: vi.fn(async () => ({ success: true, data: { firstName: 'Ada', lastName: 'Admin', email: 'ada@example.test' } })),
}));
vi.mock('@alga-psa/onboarding/components', () => ({
  OnboardingWizard: (props: any) => {
    mocks.wizardProps(props);
    return <div data-testid="wizard" />;
  },
}));

import OnboardingPage from '../../../../../app/msp/onboarding/page';
import { getTenantSettings } from '@alga-psa/tenancy/actions';

const member = (email: string) => ({ firstName: 'T', lastName: 'M', email, role: 'Technician' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canRun = true;
  mocks.settings = { onboarding_completed: false, onboarding_data: { teamMembers: [member('tom@example.test'), member('sue@example.test')] } };
});

describe('onboarding page', () => {
  it('hands the wizard the saved team members marked as already created', async () => {
    render(<OnboardingPage />);
    await screen.findByTestId('wizard');

    const { initialData } = mocks.wizardProps.mock.calls.at(-1)![0];
    expect(initialData.teamMembers.map((m: any) => m.email)).toEqual(['tom@example.test', 'sue@example.test']);
    expect(initialData.createdTeamMemberEmails).toEqual(['tom@example.test', 'sue@example.test']);
  });

  it('restores the created members for a returning user as well', async () => {
    mocks.settings = { ...mocks.settings, onboarding_completed: true };
    render(<OnboardingPage />);
    await screen.findByTestId('wizard');
    expect(mocks.wizardProps.mock.calls.at(-1)![0].initialData.createdTeamMemberEmails)
      .toEqual(['tom@example.test', 'sue@example.test']);
  });

  it('redirects a user who cannot run workspace setup to the dashboard', async () => {
    mocks.canRun = false;
    render(<OnboardingPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/msp/dashboard'));
    // Nothing is loaded for them: no settings read, no saved progress handed over.
    await waitFor(() => expect(mocks.wizardProps).toHaveBeenCalled());
    expect(mocks.wizardProps.mock.calls.at(-1)![0].initialData).toEqual({});
    expect(getTenantSettings).not.toHaveBeenCalled();
  });

  it('does not redirect an administrator', async () => {
    render(<OnboardingPage />);
    await screen.findByTestId('wizard');
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
