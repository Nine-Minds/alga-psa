/**
 * Vitest setup for @alga-psa/integrations package tests.
 *
 * Mirrors the relevant parts of server/src/test/setup.ts so that the
 * pre-existing co-located tests behave the same when run from this package.
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

process.env.NEXTAUTH_SECRET ??= 'localtest-nextauth-secret';

// Add ResizeObserver polyfill (jsdom does not provide one)
(globalThis as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock UI reflection hooks
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
    updateMetadata: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/ui-reflection/useRegisterUIComponent', () => ({
  useRegisterUIComponent: () => vi.fn(),
}));

vi.mock('@alga-psa/ui/ui-reflection/useRegisterChild', () => ({
  useRegisterChild: () => vi.fn(),
}));

vi.mock('@alga-psa/ui/ui-reflection/UIStateContext', () => ({
  useUIState: () => ({
    state: {},
    dispatch: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
  UIStateProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  // Stable identities: components hang fetch effects off `t` via useCallback,
  // so a fresh function per render causes infinite reload loops.
  const t = (_key: string, options?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
    if (typeof options === 'string') {
      return options;
    }
    const template = options?.defaultValue ?? _key;
    return template.replace(/\{\{(\w+)\}\}/g, (match, name) => {
      const value = options?.[name];
      return value === undefined || value === null ? match : String(value);
    });
  };
  const translation = { t };
  return { useTranslation: () => translation };
});

vi.mock('@alga-psa/auth', () => {
  const defaultUser = {
    user_id: '00000000-0000-0000-0000-000000000001',
    tenant: '00000000-0000-0000-0000-000000000001',
    roles: [],
  };

  const getCurrentUser = vi.fn().mockResolvedValue(defaultUser);
  const hasPermission = vi.fn().mockResolvedValue(true);

  const resolveTenant = async (user: any): Promise<string> => {
    if (user?.tenant && typeof user.tenant === 'string') {
      return user.tenant;
    }
    return defaultUser.tenant;
  };

  const withAuth = (handler: (...args: any[]) => any) => {
    return async (...args: any[]) => {
      const user = await getCurrentUser();
      const tenant = await resolveTenant(user);
      const authUser = user ? { ...user, tenant } : { ...defaultUser, tenant };
      return handler(authUser, { tenant }, ...args);
    };
  };

  const withOptionalAuth = (handler: (...args: any[]) => any) => {
    return async (...args: any[]) => {
      const user = await getCurrentUser();
      if (!user) {
        return handler(null, null, ...args);
      }
      const tenant = await resolveTenant(user);
      return handler({ ...user, tenant }, { tenant }, ...args);
    };
  };

  const withAuthCheck = (handler: (...args: any[]) => any) => {
    return async (...args: any[]) => {
      const user = await getCurrentUser();
      const tenant = await resolveTenant(user);
      const authUser = user ? { ...user, tenant } : { ...defaultUser, tenant };
      return handler(authUser, { tenant }, ...args);
    };
  };

  return {
    getSession: vi.fn().mockResolvedValue(null),
    getCurrentUser,
    hasPermission,
    withAuth,
    withAuthCheck,
    withOptionalAuth,
  };
});
