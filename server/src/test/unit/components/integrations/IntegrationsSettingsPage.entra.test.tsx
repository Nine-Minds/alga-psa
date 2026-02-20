/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  GoogleIntegrationSettings: () => <div data-testid="google-integration-settings-stub" />,
}));

vi.mock('@alga-psa/integrations/components', () => ({
  __esModule: true,
  EmailProviderConfiguration: () => <div data-testid="email-provider-config-stub" />,
  CalendarIntegrationsSettings: () => <div data-testid="calendar-integrations-settings-stub" />,
}));

vi.mock('@enterprise/components/settings/integrations/EntraIntegrationSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="entra-integration-settings-shell">Entra Settings Shell</div>,
}));

vi.mock('@product/billing/entry', () => ({
  __esModule: true,
  StripeConnectionSettings: () => <div data-testid="stripe-settings-shell">Stripe Settings Shell</div>,
}));

describe('IntegrationsSettingsPage Entra placement', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    useSearchParamsMock.mockReturnValue({
      get: (key: string) => (key === 'category' ? 'identity' : null),
    });

    useFeatureFlagMock.mockReturnValue({
      enabled: true,
      isLoading: false,
      error: null,
      value: true,
    });
  });

  afterEach(() => {
    if (originalEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalEdition;
    }
    vi.clearAllMocks();
  });

  it('renders the Microsoft Entra integration entry in EE mode', async () => {
    const { default: IntegrationsSettingsPage } = await import(
      '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
    );

    render(<IntegrationsSettingsPage />);

    expect(screen.getByTestId('custom-tabs-mock')).toBeInTheDocument();
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Identity Integrations')).toBeInTheDocument();
    expect(screen.getByText('Loading Entra integration settings...')).toBeInTheDocument();
  });

  it('hides Entra settings surface when entra-integration-ui flag is disabled', async () => {
    useFeatureFlagMock.mockReturnValue({
      enabled: false,
      isLoading: false,
      error: null,
      value: false,
    });

    const { default: IntegrationsSettingsPage } = await import(
      '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
    );

    render(<IntegrationsSettingsPage />);

    expect(screen.queryByText('Identity')).not.toBeInTheDocument();
    expect(screen.queryByText('Identity Integrations')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading Entra integration settings...')).not.toBeInTheDocument();
  });
});
