/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string } | string) =>
      typeof options === 'string' ? options : options?.defaultValue ?? _key,
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ handleError: vi.fn() }));
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
vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantLogoActions', () => ({
  uploadTenantLogo: vi.fn(),
  deleteTenantLogo: vi.fn(),
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
  // The pair picker always renders, EE or not.
  await waitFor(() => expect(
    document.querySelector('[data-automation-id="theme-pair-alga"]'),
  ).toBeTruthy());
}

describe('AppearanceSettings edition gate', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('offers the custom theme editor and MSP white-label on Enterprise', async () => {
    await renderAppearance('enterprise');

    expect(screen.getByText(CUSTOM_THEME_HEADING)).toBeTruthy();
    expect(screen.getByText(WHITE_LABEL_HEADING)).toBeTruthy();
    // Both shared logo slots are available here, but the MSP opt-in is explicit.
    expect(screen.getAllByTestId('entity-image-upload')).toHaveLength(2);
    expect(screen.getByText('Enable MSP UI customization')).toBeTruthy();
  });

  it('hides both Enterprise sections in Community and keeps the pair picker', async () => {
    await renderAppearance('community');

    expect(screen.queryByText(CUSTOM_THEME_HEADING)).toBeNull();
    expect(screen.queryByText(WHITE_LABEL_HEADING)).toBeNull();
    expect(screen.getByText('Slate')).toBeTruthy();
    expect(screen.getByText('High contrast')).toBeTruthy();
  });
});
