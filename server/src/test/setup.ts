import '@testing-library/jest-dom'
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { vi } from 'vitest';

process.env.NEXTAUTH_SECRET ??= 'localtest-nextauth-secret';

// Vitest coverage (v8) uses a temp directory under the reports directory.
// Some runs can error if the temp directory is missing; ensure it exists.
try {
  mkdirSync(path.resolve(process.cwd(), 'server/coverage/.tmp'), { recursive: true });
} catch {
  // ignore
}

// Add ResizeObserver polyfill
global.ResizeObserver = class ResizeObserver {
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
  UIStateProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: string | { defaultValue?: string }) => {
      if (typeof options === 'string') {
        return options;
      }
      return options?.defaultValue ?? _key;
    },
  }),
}));

vi.mock('next/server', async () => {
  const mod = await import('./stubs/next-server');
  return mod;
});

vi.mock('server/src/app/api/auth/[...nextauth]/edge-auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

vi.mock('@alga-psa/auth', () => {
  const defaultUser = {
    user_id: '00000000-0000-0000-0000-000000000001',
    tenant: '00000000-0000-0000-0000-000000000001',
    roles: [],
  };

  const getCurrentUser = vi.fn().mockResolvedValue(defaultUser);
  const hasPermission = vi.fn().mockResolvedValue(true);

  const resolveTenant = async (user: any): Promise<string> => {
    try {
      const dbModule = await import('server/src/lib/db');
      const tenant = dbModule.getCurrentTenantId?.();
      if (tenant && typeof tenant === 'string') {
        return tenant;
      }
    } catch {
      // best-effort fallback for tests that do not mock db context
    }

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

  return {
    getSession: vi.fn().mockResolvedValue(null),
    getCurrentUser,
    hasPermission,
    withAuth,
    withOptionalAuth,
  };
});
