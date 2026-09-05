/**
 * @vitest-environment jsdom
 *
 * The custom editor must open on the pair the tenant is actually running.
 * A palette saved during an earlier visit used to shadow it, so an admin on
 * Forest was handed purple Alga swatches with only the Reset button's label
 * mentioning Forest.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_THEME_PRESETS } from '@alga-psa/tenancy/lib/customTheme';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> | string) => {
      if (typeof options === 'string') return options;
      const template = (options?.defaultValue as string) ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
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

const getTenantThemeAction = vi.fn();
const updateTenantThemeAction = vi.fn(async () => ({ success: true }));

vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantThemeActions', () => ({
  getTenantThemeAction: (...args: unknown[]) => getTenantThemeAction(...args),
  updateTenantThemeAction: (...args: unknown[]) => updateTenantThemeAction(...args),
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

// A palette left behind by an earlier visit — deliberately the Alga colors, the
// exact case that made the bug invisible.
const STALE_SAVED_THEME = {
  light: { ...CUSTOM_THEME_PRESETS.alga.light, primary: '#8a4dea' },
  dark: { ...CUSTOM_THEME_PRESETS.alga.dark },
};

// The component labels its controls with data-automation-id, not data-testid.
const byAutomationId = (id: string) => document.querySelector<HTMLElement>(`[data-automation-id="${id}"]`);

const swatch = (mode: 'light' | 'dark', key: string) =>
  byAutomationId(`custom-theme-${mode}-${key}`)?.textContent?.trim();

async function renderAppearance() {
  vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
  const { default: AppearanceSettings } = await import('@/components/settings/general/AppearanceSettings');
  render(<AppearanceSettings />);
  await waitFor(() => expect(screen.getByText('Custom theme')).toBeTruthy());
}

describe('AppearanceSettings custom theme seeding', () => {
  beforeEach(() => {
    updateTenantThemeAction.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('seeds the editor from the running pair even when an old palette is saved', async () => {
    getTenantThemeAction.mockResolvedValue({ pairId: 'forest', customTheme: STALE_SAVED_THEME });
    await renderAppearance();

    expect(swatch('light', 'primary')).toBe(CUSTOM_THEME_PRESETS.forest.light.primary);
    expect(swatch('light', 'sidebarBg')).toBe(CUSTOM_THEME_PRESETS.forest.light.sidebarBg);
    expect(swatch('light', 'background')).toBe(CUSTOM_THEME_PRESETS.forest.light.background);
    expect(byAutomationId('custom-theme-seeded-from')?.textContent).toContain('Forest');
    expect(screen.getByRole('button', { name: 'Reset to Forest colors' })).toBeTruthy();

    // The dark half follows the same pair.
    await userEvent.click(byAutomationId('custom-theme-mode-dark')!);
    expect(swatch('dark', 'background')).toBe(CUSTOM_THEME_PRESETS.forest.dark.background);
    expect(swatch('dark', 'primary')).toBe(CUSTOM_THEME_PRESETS.forest.dark.primary);
  });

  it('keeps the saved palette reachable and hides the seeding note once restored', async () => {
    getTenantThemeAction.mockResolvedValue({ pairId: 'ocean', customTheme: STALE_SAVED_THEME });
    await renderAppearance();

    expect(swatch('light', 'primary')).toBe(CUSTOM_THEME_PRESETS.ocean.light.primary);

    await userEvent.click(screen.getByRole('button', { name: 'Use my saved colors' }));

    expect(swatch('light', 'primary')).toBe(STALE_SAVED_THEME.light.primary);
    expect(byAutomationId('custom-theme-seeded-from')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use my saved colors' })).toBeNull();
  });

  it('edits the tenant’s own palette when the custom pair is the one in use', async () => {
    getTenantThemeAction.mockResolvedValue({ pairId: 'custom', customTheme: STALE_SAVED_THEME });
    await renderAppearance();

    expect(swatch('light', 'primary')).toBe(STALE_SAVED_THEME.light.primary);
    expect(byAutomationId('custom-theme-seeded-from')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use my saved colors' })).toBeNull();
  });

  it('follows along when the admin picks a different pair', async () => {
    getTenantThemeAction.mockResolvedValue({ pairId: 'forest', customTheme: null });
    await renderAppearance();

    await userEvent.click(byAutomationId('theme-pair-cappuccino')!);

    await waitFor(() => expect(swatch('light', 'primary')).toBe(CUSTOM_THEME_PRESETS.cappuccino.light.primary));
    expect(byAutomationId('custom-theme-seeded-from')?.textContent).toContain('Cappuccino');
    // Picking a pair only previews it.
    expect(updateTenantThemeAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Apply to everyone' }));

    // Pair changes never ship unsaved editor colors to the server.
    await waitFor(() => expect(updateTenantThemeAction).toHaveBeenCalledWith(
      expect.objectContaining({ pairId: 'cappuccino' }),
    ));
    expect(updateTenantThemeAction.mock.calls[0][0]).not.toHaveProperty('customTheme');
  });

  // Picking a pair used to persist on click, so an admin who only wanted to look
  // had already changed it for everyone.
  it('previews a pair on the whole app but persists nothing until it is applied', async () => {
    getTenantThemeAction.mockResolvedValue({ pairId: 'forest', customTheme: null });
    await renderAppearance();

    expect(byAutomationId('appearance-unsaved-bar')).toBeNull();

    await userEvent.click(byAutomationId('theme-pair-vice')!);

    expect(document.documentElement.getAttribute('data-theme-pair')).toBe('vice');
    expect(byAutomationId('appearance-unsaved-bar')).toBeTruthy();
    expect(updateTenantThemeAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(document.documentElement.getAttribute('data-theme-pair')).toBe('forest'));
    expect(byAutomationId('appearance-unsaved-bar')).toBeNull();
    expect(updateTenantThemeAction).not.toHaveBeenCalled();
  });

  it('previews the custom pair and saves its colors on apply', async () => {
    getTenantThemeAction.mockResolvedValue({ pairId: 'forest', customTheme: null });
    await renderAppearance();

    await userEvent.click(byAutomationId('theme-pair-custom')!);
    expect(document.documentElement.getAttribute('data-theme-pair')).toBe('custom');
    // The preview needs real CSS for the custom pair, which no stylesheet ships.
    expect(document.getElementById('preview-tenant-theme-styles')?.textContent)
      .toContain('html.dark[data-theme-pair="custom"]');

    await userEvent.click(screen.getByRole('button', { name: 'Apply to everyone' }));

    await waitFor(() => expect(updateTenantThemeAction).toHaveBeenCalled());
    const payload = updateTenantThemeAction.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.pairId).toBe('custom');
    expect(payload).toHaveProperty('customTheme');
  });
});
