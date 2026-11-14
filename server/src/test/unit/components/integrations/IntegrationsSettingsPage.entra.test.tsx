/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
// Load the subject during collection: a timed-out dynamic import can resume
// after cleanup and render into the next test's document.
import IntegrationsSettingsPage from '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage';

const useSearchParamsMock = vi.hoisted(() => vi.fn());
const useFeatureFlagMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// Resolve integration category labels/descriptions against the real msp/settings
// translation bundle (the page calls t(key) without defaultValues).
vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const path = await import('node:path');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const settings = require(
    path.resolve(process.cwd(), 'public/locales/en/msp/settings.json'),
  );
  const get = (obj: any, key: string) =>
    key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);
  const t = (key: string, options?: any) => {
    const template = get(settings, key) ?? options?.defaultValue ?? key;
    if (typeof template !== 'string') {
      return key;
    }
    return template.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) =>
      options && options[name] != null ? String(options[name]) : match,
    );
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en' } }),
    useFormatters: () => ({
      formatDate: (d: Date | string) => String(d),
      formatNumber: (n: number) => String(n),
      formatCurrency: (n: number) => String(n),
      formatRelativeTime: (d: Date | string) => String(d),
    }),
    useI18n: () => ({ locale: 'en' }),
    useOptionalI18n: () => ({ locale: 'en' }),
    detectClientLocale: () => 'en',
    I18nProvider: ({ children }: any) => children,
  };
});

// Drive edition exclusively via NEXT_PUBLIC_EDITION (the process-wide EDITION is
// 'enterprise' in the test env and would otherwise freeze isEnterprise true).
vi.mock('../../../../../../packages/integrations/src/lib/calendarAvailability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../packages/integrations/src/lib/calendarAvailability')>();
  const isCalendarEnterpriseEdition = (env: NodeJS.ProcessEnv = process.env) =>
    (env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';
  return {
    ...actual,
    isCalendarEnterpriseEdition,
    getVisibleIntegrationCategoryIds: (isEE = isCalendarEnterpriseEdition()) =>
      actual.getVisibleIntegrationCategoryIds(isEE),
    resolveIntegrationSettingsCategory: (requested: string | null | undefined, isEE = isCalendarEnterpriseEdition()) =>
      actual.resolveIntegrationSettingsCategory(requested, isEE),
    getVisibleUserProfileTabs: (isEE = isCalendarEnterpriseEdition()) =>
      actual.getVisibleUserProfileTabs(isEE),
    resolveUserProfileTab: (requested: string | null | undefined, isEE = isCalendarEnterpriseEdition()) =>
      actual.resolveUserProfileTab(requested, isEE),
  };
});

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  __esModule: true,
  default: ({ tabs, defaultTab }: { tabs: Array<{ id: string; label: string; content: React.ReactNode }>; defaultTab: string }) => {
    // The page selects tabs by id (matches the real CustomTabs contract), not label.
    const selected = tabs.find((tab) => tab.id === defaultTab) ?? tabs[0];

    return (
      <div data-testid="custom-tabs-mock">
        <div>
          {tabs.map((tab) => (
            <span key={tab.id}>{tab.label}</span>
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

// These panels are outside Identity's contract. Mock the page's direct
// dependencies so collection never loads their server actions or SDKs.
vi.mock('@alga-psa/integrations/components/settings/integrations/ProviderCredentialsWorkbench', () => ({
  ProviderCredentialsWorkbench: () => <div data-testid="provider-credentials-stub" />,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/CalendarEnterpriseIntegrationSettings', () => ({
  CalendarEnterpriseIntegrationSettings: () => <div data-testid="calendar-integrations-stub" />,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/TeamsEnterpriseIntegrationSettings', () => ({
  TeamsEnterpriseIntegrationSettings: () => <div data-testid="teams-integrations-stub" />,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/telephony/TelephonyEnterpriseIntegrationSettings', () => ({
  TelephonyEnterpriseIntegrationSettings: () => <div data-testid="telephony-integrations-stub" />,
}));
vi.mock('../../../../../../packages/integrations/src/components/email/EmailProviderConfiguration', () => ({
  EmailProviderConfiguration: () => <div data-testid="email-provider-config-stub" />,
}));

// The Identity category renders Entra's summary card; the surface itself has its own route.
vi.mock('@alga-psa/integrations/entra/components/entry', () => ({
  __esModule: true,
  EntraIntegrationSummaryCard: () => (
    <div data-testid="entra-integration-settings-shell">Loading Entra integration settings...</div>
  ),
}));

vi.mock('@product/billing/entry', () => ({
  __esModule: true,
  StripeConnectionSettings: () => <div data-testid="stripe-settings-shell">Stripe Settings Shell</div>,
}));

describe('IntegrationsSettingsPage Entra placement', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    // RTL auto-cleanup only registers for the first test file in the shared
    // fork (externalized @testing-library/react is cached process-wide), so
    // clean up explicitly to keep renders from leaking across tests.
    cleanup();
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    useSearchParamsMock.mockReturnValue({
      get: (key: string) => (key === 'category' ? 'identity' : null),
    });

    // Identity must remain available independently of feature-flag state.
    useFeatureFlagMock.mockReturnValue({ enabled: false, loading: false, error: null });
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

  it('renders the Microsoft Entra integration entry in EE mode', () => {
    render(<IntegrationsSettingsPage />);

    expect(screen.getByTestId('custom-tabs-mock')).toBeInTheDocument();
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Identity Integrations')).toBeInTheDocument();
    expect(screen.getByText('Loading Entra integration settings...')).toBeInTheDocument();
  });

  it('shows Entra settings while PostHog is unavailable', () => {
    useFeatureFlagMock.mockReturnValue({ enabled: false, loading: true, error: new Error('PostHog unavailable') });

    render(<IntegrationsSettingsPage />);

    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Identity Integrations')).toBeInTheDocument();
    expect(screen.getByText('Loading Entra integration settings...')).toBeInTheDocument();
  });

  it('hides Identity outside EE builds', () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';

    render(<IntegrationsSettingsPage />);

    expect(screen.queryByText('Identity')).not.toBeInTheDocument();
    expect(screen.queryByText('Identity Integrations')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading Entra integration settings...')).not.toBeInTheDocument();
    expect(screen.getByTestId('custom-tabs-mock')).toBeInTheDocument();
  });

  it('keeps Identity visible while preserving the Entra tier notice', () => {
    render(<IntegrationsSettingsPage canUseEntraSync={false} />);

    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Entra requires the Enterprise add-on')).toBeInTheDocument();
    expect(screen.queryByText('Loading Entra integration settings...')).not.toBeInTheDocument();
  });

  it('updates Identity access when the add-on entitlement changes on the mounted page', () => {
    const { rerender } = render(<IntegrationsSettingsPage canUseEntraSync={false} />);

    expect(screen.getByText('Microsoft Entra requires the Enterprise add-on')).toBeInTheDocument();
    expect(screen.queryByTestId('entra-integration-settings-shell')).not.toBeInTheDocument();

    rerender(<IntegrationsSettingsPage canUseEntraSync />);

    expect(screen.getByTestId('entra-integration-settings-shell')).toBeInTheDocument();
    expect(screen.queryByText('Microsoft Entra requires the Enterprise add-on')).not.toBeInTheDocument();

    rerender(<IntegrationsSettingsPage canUseEntraSync={false} />);

    expect(screen.getByText('Identity Integrations')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Entra requires the Enterprise add-on')).toBeInTheDocument();
    expect(screen.queryByTestId('entra-integration-settings-shell')).not.toBeInTheDocument();
  });
});
