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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// Resolve integration category labels/descriptions against the real msp/settings
// translation bundle. The page calls t(key) without defaultValues, so the shared
// key-returning mock cannot satisfy these human-readable assertions.
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

vi.mock('@alga-psa/ui/hooks', async () => {
  const actual = await vi.importActual<object>('@alga-psa/ui/hooks');
  return {
    ...actual,
    useFeatureFlag: useFeatureFlagMock,
  };
});

// The edition is otherwise frozen at module load via @alga-psa/core's static
// `isEnterprise`. Re-derive it from process.env at call time so each test can
// toggle edition through NEXT_PUBLIC_EDITION before importing the page.
vi.mock('../../../../../../packages/integrations/src/lib/calendarAvailability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../packages/integrations/src/lib/calendarAvailability')>();
  // These tests drive edition exclusively through NEXT_PUBLIC_EDITION; the
  // process-wide EDITION (set to 'enterprise' by server/.env in the test env)
  // is intentionally ignored so CE/EE cases stay independently controllable.
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

    // The simplified Providers tab renders no category heading/description banner,
    // so no shared Providers copy (Calendar guidance included) can appear.
    expect(screen.queryByText('Providers Integrations')).not.toBeInTheDocument();
    expect(screen.getByText('Google Integration Settings')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Integration Settings')).toBeInTheDocument();
    expect(screen.queryByText(/Calendar integration screens/i)).not.toBeInTheDocument();
  });
});
