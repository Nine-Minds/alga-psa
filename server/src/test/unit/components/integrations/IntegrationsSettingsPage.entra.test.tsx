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

vi.mock('@alga-psa/ui/hooks', async () => {
  const actual = await vi.importActual<object>('@alga-psa/ui/hooks');
  return {
    ...actual,
    useFeatureFlag: useFeatureFlagMock,
  };
});

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

vi.mock('@alga-psa/integrations/components/settings/integrations/GoogleIntegrationSettings', () => ({
  __esModule: true,
  GoogleIntegrationSettings: () => <div data-testid="google-integration-settings-stub" />,
}));

vi.mock('@alga-psa/integrations/components', () => ({
  __esModule: true,
  EmailProviderConfiguration: () => <div data-testid="email-provider-config-stub" />,
  CalendarIntegrationsSettings: () => <div data-testid="calendar-integrations-settings-stub" />,
}));

// The page imports the Entra settings surface from the integrations entry barrel.
vi.mock('@alga-psa/integrations/entra/components/entry', () => ({
  __esModule: true,
  EntraIntegrationSettings: () => (
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

  it('shows Entra settings surface when entra-integration-ui flag is enabled', async () => {
    useFeatureFlagMock.mockReturnValue({
      enabled: true,
      isLoading: false,
      error: null,
      value: true,
    });

    const { default: IntegrationsSettingsPage } = await import(
      '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
    );

    render(<IntegrationsSettingsPage />);

    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Identity Integrations')).toBeInTheDocument();
    expect(
      screen.queryByText('Loading Entra integration settings...') ||
      screen.queryByTestId('entra-integration-settings-shell')
    ).toBeTruthy();
  });
});
