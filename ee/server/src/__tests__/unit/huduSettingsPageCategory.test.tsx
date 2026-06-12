// @vitest-environment jsdom
/**
 * T030 — IntegrationsSettingsPage renders the Hudu item under the
 * "IT Documentation" category only when the Hudu gate (EE + the
 * `hudu-integration` feature flag, via useHuduIntegrationEnabled) is enabled.
 *
 * The page's sibling integration components, UI primitives, and i18n are
 * mocked; calendarAvailability keeps its real category-id logic with the
 * edition probe overridden per test.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IntegrationsSettingsPage from '@alga-psa/integrations/components/settings/integrations/IntegrationsSettingsPage';

const { useHuduIntegrationEnabledMock, useFeatureFlagMock, isEEMock } = vi.hoisted(() => ({
  useHuduIntegrationEnabledMock: vi.fn(),
  useFeatureFlagMock: vi.fn(),
  isEEMock: vi.fn(),
}));

// Same module as the page's relative './useHuduIntegrationEnabled' import.
vi.mock('@alga-psa/integrations/components/settings/integrations/useHuduIntegrationEnabled', () => ({
  useHuduIntegrationEnabled: useHuduIntegrationEnabledMock,
}));

vi.mock('@alga-psa/integrations/lib/calendarAvailability', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@alga-psa/integrations/lib/calendarAvailability');
  return {
    ...actual,
    isCalendarEnterpriseEdition: isEEMock,
  };
});

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: useFeatureFlagMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;
  return { useTranslation: () => ({ t }) };
});

// next/dynamic loaders (Stripe, Hudu) are replaced with inert stubs.
vi.mock('next/dynamic', () => ({
  default: () => {
    const DynamicStub = () => <div data-testid="dynamic-integration-stub" />;
    return DynamicStub;
  },
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  default: () => <span data-testid="spinner" />,
}));

// Render every tab (label + content) so presence/absence can be asserted.
vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  default: ({ tabs }: { tabs: Array<{ id?: string; label: string; content: React.ReactNode }> }) => (
    <div>
      {tabs.map((tab) => (
        <div key={tab.id ?? tab.label} data-tab-id={tab.id ?? tab.label}>
          <span>{tab.label}</span>
          <div>{tab.content}</div>
        </div>
      ))}
    </div>
  ),
}));

// Sibling integration components (same resolved modules as the page's relative imports).
vi.mock('@alga-psa/integrations/components/settings/integrations/AccountingIntegrationsSetup', () => ({
  default: () => <div data-testid="accounting-stub" />,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/RmmIntegrationsSetup', () => ({
  default: () => <div data-testid="rmm-stub" />,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/GoogleIntegrationSettings', () => ({
  GoogleIntegrationSettings: () => <div data-testid="google-stub" />,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/MicrosoftIntegrationSettings', () => ({
  MicrosoftIntegrationSettings: () => <div data-testid="microsoft-stub" />,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/MspSsoLoginDomainsSettings', () => ({
  MspSsoLoginDomainsSettings: () => <div data-testid="msp-sso-stub" />,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/CalendarEnterpriseIntegrationSettings', () => ({
  CalendarEnterpriseIntegrationSettings: () => <div data-testid="calendar-stub" />,
}));
vi.mock('@alga-psa/integrations/components/settings/integrations/TeamsEnterpriseIntegrationSettings', () => ({
  TeamsEnterpriseIntegrationSettings: () => <div data-testid="teams-stub" />,
}));
vi.mock('@alga-psa/integrations/components', () => ({
  EmailProviderConfiguration: () => <div data-testid="email-provider-stub" />,
}));
vi.mock('@alga-psa/integrations/entra/components/entry', () => ({
  EntraIntegrationSettings: () => <div data-testid="entra-stub" />,
}));

describe('IntegrationsSettingsPage — Hudu IT Documentation category gating (T030)', () => {
  beforeEach(() => {
    useHuduIntegrationEnabledMock.mockReset();
    useFeatureFlagMock.mockReset();
    isEEMock.mockReset();
    useFeatureFlagMock.mockReturnValue({ enabled: false, loading: false });
    isEEMock.mockReturnValue(true);
  });

  it('renders the Hudu item under IT Documentation when the gate (EE + flag) is enabled', () => {
    useHuduIntegrationEnabledMock.mockReturnValue({ enabled: true, loading: false });

    render(<IntegrationsSettingsPage />);

    const tab = document.querySelector('[data-tab-id="it-documentation"]');
    expect(tab).not.toBeNull();
    expect(tab?.textContent).toContain('integrations.categories.itDocumentation.label');
    // The single Hudu item renders its (dynamic-stubbed) settings component.
    expect(tab?.querySelectorAll('[data-testid="dynamic-integration-stub"]')).toHaveLength(1);
  });

  it('hides the IT Documentation category when the gate is disabled (flag off)', () => {
    useHuduIntegrationEnabledMock.mockReturnValue({ enabled: false, loading: false });

    render(<IntegrationsSettingsPage />);

    expect(document.querySelector('[data-tab-id="it-documentation"]')).toBeNull();
    expect(screen.queryByText('integrations.categories.itDocumentation.label')).toBeNull();
  });

  it('hides the IT Documentation category in CE even if the hook were to report enabled', () => {
    // CE: the category id is not in the visible list, so the tab cannot render
    // regardless of the (EE-only) gate value.
    isEEMock.mockReturnValue(false);
    useHuduIntegrationEnabledMock.mockReturnValue({ enabled: true, loading: false });

    render(<IntegrationsSettingsPage />);

    expect(document.querySelector('[data-tab-id="it-documentation"]')).toBeNull();
  });
});
