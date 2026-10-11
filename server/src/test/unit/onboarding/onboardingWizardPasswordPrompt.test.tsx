/**
 * @vitest-environment jsdom
 *
 * An administrator who claimed an invitation already chose their own password. The
 * wizard must not demand a second one, and — the part that actually blocked people —
 * must not hold the first step hostage to password fields it never rendered.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingWizard } from '../../../../../packages/onboarding/src/components/OnboardingWizard';
import type { ProductCode, WizardData } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  saveOnboardingStepPosition: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../../../../packages/onboarding/src/actions', () => ({
  saveClientInfo: vi.fn(),
  addTeamMembers: vi.fn(),
  createClient: vi.fn(),
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
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useI18n: () => ({ locale: 'en', setLocale: vi.fn() }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardProgress', () => ({
  WizardProgress: ({ steps }: { steps: string[] }) => (
    <span data-testid="step-labels">{steps.join('|')}</span>
  ),
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardNavigation', () => ({
  WizardNavigation: ({ isNextDisabled }: { isNextDisabled: boolean }) => (
    <button data-testid="next-button" disabled={isNextDisabled}>Next</button>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../../packages/onboarding/src/components/steps/ClientInfoStep', () => ({
  ClientInfoStep: ({ requiresPasswordReset }: { requiresPasswordReset?: boolean }) => (
    <div data-testid="client-info-step">{String(requiresPasswordReset)}</div>
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
  mocks.saveOnboardingStepPosition.mockReset().mockResolvedValue({ success: true });
});

const claimedIdentity: Partial<WizardData> = {
  firstName: 'Dorothy',
  lastName: 'Gale',
  tenantName: 'Emerald City IT',
  email: 'dorothy@emeraldcity.example',
};

const renderWizard = (
  options: { requiresPasswordReset?: boolean; productCode?: ProductCode } = {}
) =>
  render(
    <OnboardingWizard
      fullPage
      testMode
      initialData={claimedIdentity}
      onComplete={vi.fn()}
      productCode={options.productCode ?? 'co_managed'}
      requiresPasswordReset={options.requiresPasswordReset ?? true}
    />
  );

describe('OnboardingWizard password prompt', () => {
  it('tells the first step to skip the prompt once the password is already set', () => {
    renderWizard({ requiresPasswordReset: false });

    expect(screen.getByTestId('client-info-step')).toHaveTextContent('false');
  });

  it('lets that administrator leave the first step without retyping a password', () => {
    renderWizard({ requiresPasswordReset: false });

    expect(screen.getByTestId('next-button')).not.toBeDisabled();
  });

  it('still blocks an administrator who owes a password reset', () => {
    renderWizard({ requiresPasswordReset: true });

    expect(screen.getByTestId('client-info-step')).toHaveTextContent('true');
    expect(screen.getByTestId('next-button')).toBeDisabled();
  });

  it('shows the co-managed shell copy and the co-managed step set', () => {
    renderWizard({ requiresPasswordReset: false });

    expect(screen.getByText('Set Up Your IT Workspace')).toBeInTheDocument();
    expect(
      screen.getByText('Configure your workspace, your IT team, and your ticketing defaults.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('step-labels')).toHaveTextContent(
      'Workspace|Team Members|Ticketing'
    );
  });

  it('keeps the PSA wizard asking for the initial password reset', () => {
    renderWizard({ productCode: 'psa' });

    expect(screen.getByTestId('client-info-step')).toHaveTextContent('true');
    expect(screen.getByTestId('next-button')).toBeDisabled();
    expect(screen.getByTestId('step-labels')).toHaveTextContent(
      'Your Company|Team Members|Add Client|Client Contact|Billing|Ticketing'
    );
  });
});
