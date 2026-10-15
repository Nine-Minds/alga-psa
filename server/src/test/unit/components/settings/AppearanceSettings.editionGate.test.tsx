/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown> | string) => {
      if (typeof options === 'string') return options;
      const template = (options?.defaultValue as string | undefined) ?? _key;
      return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        options?.[name] === undefined ? match : String(options[name])
      );
    },
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
  isActionPermissionError: vi.fn(() => false),
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/components/EntityImageUpload', () => ({
  default: () => <div data-testid="entity-image-upload" />,
}));

vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantThemeActions', () => ({
  getTenantThemeAction: vi.fn(async () => ({ pairId: 'alga' })),
  updateTenantThemeAction: vi.fn(async () => ({ success: true })),
}));
vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantBrandingActions', () => ({
  getTenantBrandingAction: vi.fn(async () => null),
}));
const setDashboardWelcomeUseCompanyName = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/dashboardWelcomeActions', () => ({
  getDashboardWelcomeSettingsAction: vi.fn(async () => ({ useCompanyName: false, companyName: 'Nine Minds' })),
  setDashboardWelcomeUseCompanyNameAction: (...args: unknown[]) =>
    setDashboardWelcomeUseCompanyName(...(args as [])),
}));
vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantLogoActions', () => ({
  uploadTenantLogo: vi.fn(),
  deleteTenantLogo: vi.fn(),
  recropTenantLogo: vi.fn(),
  linkDocumentAsTenantLogo: vi.fn(),
  getTenantLogoInfoAction: vi.fn(async () => null),
}));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: vi.fn(async () => ({ user_id: 'user-1', tenant: 'tenant-1' })),
}));

const CUSTOM_THEME_HEADING = 'Custom theme';
const WHITE_LABEL_HEADING = 'White-label the MSP app';

async function renderAppearance(edition: string) {
  vi.stubEnv('NEXT_PUBLIC_EDITION', edition);
  const { default: AppearanceSettings } = await import(
    '@/components/settings/general/AppearanceSettings'
  );
  render(<AppearanceSettings />);
  if (edition === 'enterprise') {
    await waitFor(() => expect(
      document.querySelector('[data-automation-id="theme-pair-alga"]'),
    ).toBeTruthy());
  }
}

describe('AppearanceSettings edition gate', () => {
  beforeEach(() => {
    setDashboardWelcomeUseCompanyName.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('offers the custom theme editor and MSP white-label on Enterprise', async () => {
    await renderAppearance('enterprise');

    expect(screen.getByText(CUSTOM_THEME_HEADING)).toBeTruthy();
    expect(screen.getByText(WHITE_LABEL_HEADING)).toBeTruthy();
    // Square mark (light/dark), wide logo (light/dark) and the favicon are all
    // available here, but the MSP opt-in is still explicit.
    expect(screen.getAllByTestId('entity-image-upload')).toHaveLength(5);
    expect(screen.getByText('Square mark')).toBeTruthy();
    expect(screen.getByText('Wide logo (optional)')).toBeTruthy();
    expect(screen.getByText('Browser icon (favicon)')).toBeTruthy();
    expect(screen.getByText('Enable MSP UI customization')).toBeTruthy();
  });

  it('saves the dashboard welcome opt-in on its own and previews the branded title', async () => {
    await renderAppearance('enterprise');

    expect(screen.getByText('Welcome to Your MSP Command Center')).toBeTruthy();

    const toggle = document.querySelector('#dashboard-welcome-company-name-toggle') as HTMLElement;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);

    await waitFor(() => expect(setDashboardWelcomeUseCompanyName).toHaveBeenCalledWith(true));
    await waitFor(() =>
      expect(screen.getByText('Welcome to the Nine Minds Command Center')).toBeTruthy()
    );
  });

  it('draws the Enterprise boundary in Community instead of the pair picker', async () => {
    await renderAppearance('community');

    expect(screen.queryByText(CUSTOM_THEME_HEADING)).toBeNull();
    expect(screen.queryByText(WHITE_LABEL_HEADING)).toBeNull();
    expect(document.querySelector('[data-automation-id="theme-pair-alga"]')).toBeNull();
    expect(screen.queryByText('Slate')).toBeNull();
    expect(document.querySelector('#appearance-upgrade-link')).toBeTruthy();
  });
});
