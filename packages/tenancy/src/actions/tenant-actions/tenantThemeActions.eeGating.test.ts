import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CUSTOM_THEME } from '../../lib/customTheme';

const settingsRow: { settings: Record<string, unknown> } = { settings: {} };
const update = vi.fn(async () => 1);
const insert = vi.fn(async () => [1]);

function mockDeps() {
  vi.doMock('@alga-psa/db', () => ({
    getConnection: async () => ({ fn: { now: () => 'now()' } }),
    tenantDb: () => ({
      table: () => ({
        first: async () => settingsRow,
        update,
        insert,
      }),
    }),
  }));
  vi.doMock('next/cache', () => ({ revalidateTag: vi.fn() }));
  vi.doMock('@alga-psa/auth', () => ({
    withAuth:
      (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        fn({ user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
    withOptionalAuth:
      (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        fn({ user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  }));
}

async function loadAction(enterprise: boolean) {
  vi.resetModules();
  mockDeps();
  vi.doMock('@alga-psa/core/features', () => ({ isEnterprise: enterprise }));
  return (await import('./tenantThemeActions')).updateTenantThemeAction;
}

const customTheme = { light: DEFAULT_CUSTOM_THEME.light, dark: DEFAULT_CUSTOM_THEME.dark };

describe('updateTenantThemeAction edition gating', () => {
  beforeEach(() => {
    settingsRow.settings = {};
    update.mockClear();
    insert.mockClear();
  });

  it('lets any edition switch between the predefined pairs', async () => {
    const action = await loadAction(false);
    await expect(action({ pairId: 'ocean' })).resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ theme: { pairId: 'ocean' } }) }),
    );
  });

  it('rejects a custom theme on Community', async () => {
    const action = await loadAction(false);
    await expect(action({ pairId: 'custom', customTheme })).rejects.toThrow(/Enterprise license/);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects MSP white-label on Community', async () => {
    const action = await loadAction(false);
    await expect(action({ pairId: 'alga', mspWhiteLabel: true })).rejects.toThrow(/Enterprise license/);
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts both on Enterprise and precomputes the custom CSS', async () => {
    const action = await loadAction(true);
    await expect(action({ pairId: 'custom', customTheme, mspWhiteLabel: true })).resolves.toEqual({
      success: true,
    });

    const saved = update.mock.calls[0][0].settings.theme;
    expect(saved.pairId).toBe('custom');
    expect(saved.mspWhiteLabel).toBe(true);
    expect(saved.customTheme.computedStyles).toContain('html.dark[data-theme-pair="custom"]');
  });

  it('refuses to select the custom pair before one exists', async () => {
    const action = await loadAction(true);
    await expect(action({ pairId: 'custom' })).rejects.toThrow(/Define a custom theme/);
  });

  it('rejects an unknown pair id', async () => {
    const action = await loadAction(true);
    await expect(action({ pairId: 'chartreuse' } as never)).rejects.toThrow(/Unknown theme pair/);
  });
});
