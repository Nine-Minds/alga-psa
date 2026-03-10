/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const useSearchParamsMock = vi.hoisted(() => vi.fn());
const useFeatureFlagMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock,
}));

vi.mock('@alga-psa/ui/hooks', async () => {
  const actual = await vi.importActual<object>('@alga-psa/ui/hooks');
  return {
    ...actual,
    useFeatureFlag: useFeatureFlagMock,
  };
});

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  __esModule: true,
  default: ({ tabs, defaultTab }: { tabs: Array<{ label: string; content: React.ReactNode }>; defaultTab: string }) => {
    const selected = tabs.find((tab) => tab.label === defaultTab) ?? tabs[0];

    return (
      <div data-testid="custom-tabs-mock">
        <div>
          {tabs.map((tab) => (
            <span key={tab.label}>{tab.label}</span>
          ))}
        </div>
        <div>{selected?.content}</div>
      </div>
    );
  },
}));

vi.mock('@alga-psa/integrations/components/settings/integrations/AccountingIntegrationsSetup', () => ({
  __esModule: true,
  default: () => <div data-testid="accounting-integrations-setup-stub">Accounting Integrations</div>,
}));

vi.mock('@alga-psa/integrations/components/settings/integrations/RmmIntegrationsSetup', () => ({
  __esModule: true,
  default: () => <div data-testid="rmm-integrations-setup-stub">RMM Integrations</div>,
}));

vi.mock('@alga-psa/integrations/components/settings/integrations/GoogleIntegrationSettings', () => ({
  __esModule: true,
  GoogleIntegrationSettings: () => <div data-testid="google-integration-settings-stub">Google Integration Settings</div>,
}));

vi.mock('@alga-psa/integrations/components/settings/integrations/MicrosoftIntegrationSettings', () => ({
  __esModule: true,
  MicrosoftIntegrationSettings: () => (
    <div data-testid="microsoft-integration-settings-stub">Microsoft Integration Settings</div>
  ),
}));

vi.mock('@alga-psa/integrations/components/settings/integrations/MspSsoLoginDomainsSettings', () => ({
  __esModule: true,
  MspSsoLoginDomainsSettings: () => <div data-testid="msp-sso-domains-stub">MSP SSO Login Domains</div>,
}));

vi.mock('@alga-psa/integrations/components', () => ({
  __esModule: true,
  EmailProviderConfiguration: () => <div data-testid="email-provider-config-stub">Inbound Email Settings</div>,
  CalendarIntegrationsSettings: () => <div data-testid="shared-calendar-integrations-settings-stub" />,
}));

vi.mock('@alga-psa/integrations/entra/components/entry', () => ({
  __esModule: true,
  EntraIntegrationSettings: () => <div data-testid="entra-integration-settings-shell">Entra Settings Shell</div>,
}));

vi.mock('@alga-psa/ee-microsoft-teams/components', () => ({
  __esModule: true,
  TeamsIntegrationSettings: () => <div data-testid="teams-integration-settings-shell">Teams Integration Settings</div>,
}));

vi.mock('@alga-psa/ee-calendar/components', () => ({
  __esModule: true,
  CalendarIntegrationsSettings: () => <div data-testid="calendar-enterprise-settings-shell">Calendar Enterprise Settings</div>,
}));

vi.mock('@product/billing/entry', () => ({
  __esModule: true,
  StripeConnectionSettings: () => <div data-testid="stripe-settings-shell">Stripe Settings Shell</div>,
}));

describe('IntegrationsSettingsPage Calendar placement', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    useFeatureFlagMock.mockImplementation(() => ({
      enabled: false,
      isLoading: false,
      error: null,
      value: false,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();

    if (originalEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalEdition;
    }
  });

  it('T391/T392: replaces old CE calendar-visibility assertions with CE-hidden regression coverage', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    useSearchParamsMock.mockReturnValue({
      get: (key: string) => (key === 'category' ? 'calendar' : null),
    });

    const { default: IntegrationsSettingsPage } = await import(
      '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
    );

    render(<IntegrationsSettingsPage />);

    expect(screen.getByRole('heading', { name: 'Accounting Integrations' })).toBeInTheDocument();
    expect(screen.queryByText('Calendar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('calendar-enterprise-settings-shell')).not.toBeInTheDocument();
  });

  it('keeps Calendar visible in EE through the enterprise wrapper', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    useSearchParamsMock.mockReturnValue({
      get: (key: string) => (key === 'category' ? 'calendar' : null),
    });

    const { default: IntegrationsSettingsPage } = await import(
      '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
    );

    render(<IntegrationsSettingsPage />);

    expect(screen.getByText('Calendar Integrations')).toBeInTheDocument();
    expect(screen.getByText('Enterprise-only calendar sync for Google and Outlook keeps dispatch and client appointments aligned.')).toBeInTheDocument();
    expect(
      (await screen.findByTestId('calendar-enterprise-settings-shell').catch(() => null)) ??
        screen.getByText('Loading calendar settings...')
    ).toBeTruthy();
  });

  it('removes Calendar setup guidance from the shared Providers copy in CE', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    useSearchParamsMock.mockReturnValue({
      get: (key: string) => (key === 'category' ? 'providers' : null),
    });

    const { default: IntegrationsSettingsPage } = await import(
      '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
    );

    render(<IntegrationsSettingsPage />);

    expect(screen.getByText('Providers Integrations')).toBeInTheDocument();
    expect(screen.getByText('Configure shared provider credentials used by email, MSP SSO, and other integrations.')).toBeInTheDocument();
    expect(screen.getByText('Configure Google and Microsoft first, then connect provider accounts from the Inbound Email integration screen. MSP SSO domain discovery uses these provider credentials with tenant login-domain mappings.')).toBeInTheDocument();
    expect(screen.queryByText(/Calendar integration screens/i)).not.toBeInTheDocument();
  });
});
