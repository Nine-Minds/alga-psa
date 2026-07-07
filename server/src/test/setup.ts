import '@testing-library/jest-dom'
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { afterEach, vi } from 'vitest';

// @testing-library/react is externalized, so its module-level auto-cleanup
// afterEach registers only in the first file that imports it per fork
// (singleFork runs the whole suite in one process). Every later jsdom file
// would stack renders within itself and leak mounted trees into the files
// after it. Register cleanup here instead — setup runs per test file.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

// Same reused-jsdom hazard for window.location: several suites replace it with
// a plain stub (to swallow jsdom's not-implemented navigation), and an
// unrestored stub has no .search/.pathname and detaches from
// history.replaceState — whichever URL-reading test the shuffle seats behind
// it fails (roving per-seed failures: AutomaticInvoices client filter,
// DefaultLayout interrupt guard). Put the real Location back after every test.
const realLocation = typeof window === 'undefined' ? undefined : window.location;
afterEach(() => {
  if (!realLocation || window.location === realLocation) return;
  try {
    Object.defineProperty(window, 'location', {
      value: realLocation,
      writable: true,
      configurable: true,
    });
  } catch {
    // Property left non-configurable by a stub: a value swap is still allowed.
    Object.defineProperty(window, 'location', { value: realLocation });
  }
});

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

// Stable singletons: components that key a useMemo/useEffect on `t` or `i18n`
// would otherwise re-run forever (a synchronous render loop vitest's testTimeout
// cannot interrupt) because every useTranslation() call returned fresh refs.
const mockT = (_key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
  if (typeof options === 'string') {
    return options;
  }
  const template = options?.defaultValue ?? _key;
  return template.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) => {
    const value = options?.[name];
    return value === undefined ? match : String(value);
  });
};
const mockI18n = { language: 'en' };
const mockUseTranslation = () => ({ t: mockT, i18n: mockI18n });

// Stable formatter singleton (en locale). Components key useMemo/useEffect on
// the return value, so it must be referentially stable across renders.
const mockFormatters = {
  formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat('en', options).format(dateObj);
  },
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat('en', options).format(value),
  formatCurrency: (value: number, currency: string, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat('en', { style: 'currency', currency, ...options }).format(value),
  formatRelativeTime: (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const diff = dateObj.getTime() - Date.now();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (Math.abs(days) > 0) return rtf.format(days, 'day');
    if (Math.abs(hours) > 0) return rtf.format(hours, 'hour');
    if (Math.abs(minutes) > 0) return rtf.format(minutes, 'minute');
    return rtf.format(seconds, 'second');
  },
};
const mockUseFormatters = () => mockFormatters;

// Stable i18n context value used by useI18n/useOptionalI18n (locale-aware
// shared components like DatePicker/CurrencyInput read this).
const mockI18nContext = { locale: 'en', t: mockT, i18n: mockI18n };

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: mockUseTranslation,
  useFormatters: mockUseFormatters,
  useI18n: () => mockI18nContext,
  useOptionalI18n: () => mockI18nContext,
  detectClientLocale: () => 'en',
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
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
