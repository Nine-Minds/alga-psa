/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

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
  EntraIntegrationSummaryCard: () => <div data-testid="entra-integration-settings-shell">Entra Settings Shell</div>,
}));

vi.mock('@alga-psa/ee-microsoft-teams/components', () => ({
  __esModule: true,
  TeamsIntegrationSettings: () => <div data-testid="teams-integration-settings-shell">Teams Integration Settings</div>,
}));

// The page renders Teams and Telephony through the integrations-package
// enterprise wrappers, not the ee-microsoft-teams barrel.
vi.mock('../../../../../../packages/integrations/src/components/settings/integrations/TeamsEnterpriseIntegrationSettings', () => ({
  __esModule: true,
  TeamsEnterpriseIntegrationSettings: () => (
    <div data-testid="teams-integration-settings-shell">Teams Integration Settings</div>
  ),
}));

// Mirrors the real wrapper: EE mounts the settings, CE gets the edition notice.
vi.mock('../../../../../../packages/integrations/src/components/settings/integrations/telephony/TelephonyEnterpriseIntegrationSettings', () => ({
  __esModule: true,
  TelephonyEnterpriseIntegrationSettings: () =>
    process.env.NEXT_PUBLIC_EDITION === 'enterprise' ? (
      <div data-testid="telephony-integration-settings-shell">Telephony Integration Settings</div>
    ) : (
      <div data-testid="telephony-edition-notice">Telephony is Enterprise only</div>
    ),
}));

vi.mock('@product/billing/entry', () => ({
  __esModule: true,
  StripeConnectionSettings: () => <div data-testid="stripe-settings-shell">Stripe Settings Shell</div>,
}));

async function renderPage(props: Record<string, unknown> = {}) {
  const { default: IntegrationsSettingsPage } = await import(
    '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage'
  );
  return render(<IntegrationsSettingsPage {...props} />);
}

describe('IntegrationsSettingsPage communication sub-navigation', () => {
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

  it('T005: splits Communication into Inbound Email, Microsoft Teams and Telephony', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const { container } = await renderPage();

    expect(screen.getByText('Inbound Email')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Teams')).toBeInTheDocument();
    expect(screen.getByText('Telephony')).toBeInTheDocument();

    // Email is the landing sub-section; the others stay mounted but hidden so
    // switching back does not refetch.
    expect(container.querySelector('#integration-subsection-communication-email')).not.toHaveAttribute('hidden');
    expect(container.querySelector('#integration-subsection-communication-telephony')).toHaveAttribute('hidden');
  });

  it('T005: the Teams sub-section still mounts the existing Teams settings shell', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const { container } = await renderPage();

    fireEvent.click(screen.getByText('Microsoft Teams', { selector: 'button *, button' }));

    expect(container.querySelector('#integration-subsection-communication-microsoft-teams')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('teams-integration-settings-shell')).toBeInTheDocument();
  });

  it('T005: the Telephony sub-section mounts the telephony settings', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const { container } = await renderPage();

    fireEvent.click(screen.getByText('Telephony', { selector: 'button *, button' }));

    expect(container.querySelector('#integration-subsection-communication-telephony')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('telephony-integration-settings-shell')).toBeInTheDocument();
  });

  it('T008: without the Telephony add-on the sub-section offers the add-on, not the settings', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    await renderPage({ canUseTelephony: false });

    fireEvent.click(screen.getByText('Telephony', { selector: 'button *, button' }));

    expect(screen.queryByTestId('telephony-integration-settings-shell')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage add-ons' })).toHaveAttribute(
      'href',
      '/msp/add-ons?addon=telephony',
    );
  });

  it('T005: CE lands on Inbound Email and never mounts the telephony settings', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';

    const { container } = await renderPage();

    expect(screen.getByText('Inbound Email')).toBeInTheDocument();
    expect(container.querySelector('#integration-subsection-communication-email')).not.toHaveAttribute('hidden');

    fireEvent.click(screen.getByText('Telephony', { selector: 'button *, button' }));

    expect(screen.queryByTestId('telephony-integration-settings-shell')).not.toBeInTheDocument();
    expect(screen.getByTestId('telephony-edition-notice')).toBeInTheDocument();
  });

  it('T011: the sub-navigation exposes kebab-case reflection ids', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const { container } = await renderPage();

    const ids = [...container.querySelectorAll('[id^="integration-sub"]')].map((node) => node.id);
    expect(ids).toEqual(expect.arrayContaining([
      'integration-subnav-communication',
      'integration-subnav-communication-email',
      'integration-subnav-communication-microsoft-teams',
      'integration-subnav-communication-telephony',
      'integration-subsection-communication-email',
      'integration-subsection-communication-microsoft-teams',
      'integration-subsection-communication-telephony',
    ]));
    expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true);
  });
});
