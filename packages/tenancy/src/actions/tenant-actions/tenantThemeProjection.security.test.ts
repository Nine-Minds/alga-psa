import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: {
    theme: {
      pairId: 'custom',
      customTheme: {
        light: {
          background: '#f7f8fa', card: '#ffffff', surface: '#f8fafc', textPrimary: '#0f172a',
          textSecondary: '#475569', textMuted: '#617086', border: '#e2e8f0', borderStrong: '#94a3b8',
          primary: '#8a4dea', secondary: '#40cff9', accent: '#ff9c30', sidebarBg: '#0c111d',
          sidebarText: '#f5f5f5', sidebarHover: '#808080', headerBg: '#ffffff', credential: 'secret',
        },
        dark: {
          background: '#0c0a18', card: '#1e1836', surface: '#130d24', textPrimary: '#e8e4f6',
          textSecondary: '#c9c3e0', textMuted: '#9a92b8', border: '#312952', borderStrong: '#4b3d73',
          primary: '#8a4dea', secondary: '#53d7fa', accent: '#ffa645', sidebarBg: '#151024',
          sidebarText: '#e8e4f6', sidebarHover: '#221743', headerBg: '#151024',
        },
        computedStyles: '<style>private()</style>',
        credential: 'secret',
      },
      privateKey: 'secret',
    },
  },
}));

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));
vi.mock('@alga-psa/db', () => ({
  getConnection: async () => ({}),
  tenantDb: () => ({ table: () => ({ first: async () => ({ settings: state.settings }) }) }),
}));
vi.mock('@alga-psa/auth', () => ({
  withOptionalAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-a' }, { tenant: 'tenant-a' }, ...args),
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-a' }, { tenant: 'tenant-a' }, ...args),
}));

import { getTenantThemeAction, getTenantThemeByTenantId } from './tenantThemeActions';

describe('sibling Enterprise theme readers', () => {
  beforeEach(() => {
    state.settings.theme.customTheme.computedStyles = '<style>private()</style>';
  });

  it('projects custom themes for the tenant-id reader and its authenticated action wrapper', async () => {
    for (const response of [getTenantThemeByTenantId('tenant-a'), getTenantThemeAction()]) {
      const theme = await response;
      expect(theme.pairId).toBe('custom');
      expect(theme.customTheme?.light.primary).toBe('#8a4dea');
      expect(theme.customTheme?.light).not.toHaveProperty('credential');
      expect(theme.customTheme).not.toHaveProperty('credential');
      expect(theme).not.toHaveProperty('privateKey');
      expect(theme.customTheme?.computedStyles).not.toContain('private()');
      expect(theme.customTheme?.computedStyles).toContain('html.dark[data-theme-pair="custom"]');
    }
  });
});
