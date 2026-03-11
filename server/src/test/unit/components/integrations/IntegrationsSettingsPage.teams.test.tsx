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
  default: () => <div data-testid="accounting-integrations-setup-stub" />,
}));

vi.mock('@alga-psa/integrations/components/settings/integrations/RmmIntegrationsSetup', () => ({
  __esModule: true,
  default: () => <div data-testid="rmm-integrations-setup-stub" />,
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
  CalendarIntegrationsSettings: () => <div data-testid="calendar-integrations-settings-stub" />,
}));

vi.mock('@alga-psa/integrations/entra/components/entry', () => ({
  __esModule: true,
  EntraIntegrationSettings: () => <div data-testid="entra-integration-settings-shell">Entra Settings Shell</div>,
}));

vi.mock('@alga-psa/ee-microsoft-teams/components', () => ({
  __esModule: true,
  TeamsIntegrationSettings: () => <div data-testid="teams-integration-settings-shell">Teams Integration Settings</div>,
}));

vi.mock('@product/billing/entry', () => ({
  __esModule: true,
  StripeConnectionSettings: () => <div data-testid="stripe-settings-shell">Stripe Settings Shell</div>,
}));

describe('IntegrationsSettingsPage Teams placement', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    useSearchParamsMock.mockReturnValue({
      get: (key: string) => (key === 'category' ? 'communication' : null),
    });

    useFeatureFlagMock.mockImplementation((flagKey: string) => ({
      enabled: flagKey === 'teams-integration-ui',
      isLoading: false,
      error: null,
      value: flagKey === 'teams-integration-ui',
    }));
  });

  afterEach(() => {
    cleanup();
    if (originalEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalEdition;
    }
    vi.clearAllMocks();
  });

  it('T027/T028/T036/T042/T071/T072/T073/T074/T395/T396/T417/T418/T419: omits Teams in CE communication settings while keeping Inbound Email visible', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';

    const { default: IntegrationsSettingsPage } = await import(
      '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
    );

    render(<IntegrationsSettingsPage />);

    expect(screen.getByText('Communication Integrations')).toBeInTheDocument();
    expect(screen.getByText('Inbound Email Integration')).toBeInTheDocument();
    expect(screen.queryByTestId('teams-integration-settings-shell')).not.toBeInTheDocument();
  });

  it('T062/T064/T068/T079/T080/T105/T106/T385/T386/T419: omits Teams from the Providers category while keeping Microsoft profiles visible in CE', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    useSearchParamsMock.mockReturnValue({
      get: (key: string) => (key === 'category' ? 'providers' : null),
    });

    const { default: IntegrationsSettingsPage } = await import(
      '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
    );

    render(<IntegrationsSettingsPage />);

    expect(screen.getByText('Providers Integrations')).toBeInTheDocument();
    expect(screen.getByText('Google Integration Settings')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Integration Settings')).toBeInTheDocument();
    expect(screen.getByText('MSP SSO Login Domains')).toBeInTheDocument();
    expect(screen.queryByTestId('teams-integration-settings-shell')).not.toBeInTheDocument();
  });

  it('T040/T065/T066/T071/T072/T077/T078/T084/T097/T098/T389/T390/T391/T392/T395/T396/T403/T404/T417/T418/T420: renders Teams only in Communication when EE mode and the tenant flag are enabled', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const { default: IntegrationsSettingsPage } = await import(
      '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
    );

    render(<IntegrationsSettingsPage />);

    expect(screen.getByText('Communication Integrations')).toBeInTheDocument();
    expect(screen.getByText('Inbound Email Integration')).toBeInTheDocument();
    expect(
      screen.queryByTestId('teams-integration-settings-shell') ||
        screen.queryByText('Loading Microsoft Teams settings...')
    ).toBeTruthy();
    expect(screen.queryByText('Microsoft Integration Settings')).not.toBeInTheDocument();
  });

  it('T038/T043/T044/T075/T076/T387/T388/T401/T402/T409/T410/T421: hides Teams entirely when EE mode is on but the tenant flag is disabled', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    useFeatureFlagMock.mockImplementation((flagKey: string) => ({
      enabled: false,
      isLoading: false,
      error: null,
      value: false,
    }));

    const { default: IntegrationsSettingsPage } = await import(
      '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
    );

    render(<IntegrationsSettingsPage />);

    expect(screen.getByText('Communication Integrations')).toBeInTheDocument();
    expect(screen.getByText('Inbound Email Integration')).toBeInTheDocument();
    expect(screen.queryByTestId('teams-integration-settings-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('teams-integration-disabled-shell')).not.toBeInTheDocument();
    expect(screen.queryByText('Microsoft Teams integration disabled')).not.toBeInTheDocument();
    expect(screen.queryByText('Microsoft Teams integration is disabled for this tenant.')).not.toBeInTheDocument();
  });
});
