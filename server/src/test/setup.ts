import '@testing-library/jest-dom'
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

// Native require reaches the SAME CJS instance the externalized imports use
// (a Vite-side dynamic import would load a separate copy whose cleanup list
// and config are empty).
const nativeRequire = createRequire(import.meta.url);
const loadRootRtl = (): any | null => {
  try {
    return nativeRequire(
      path.resolve(__dirname, '../../../node_modules/@testing-library/react/dist/index.js')
    );
  } catch {
    return null; // Root copy absent (deduped) — nothing to reach.
  }
};

// @testing-library/react is externalized, so its module-level auto-cleanup
// afterEach registers only in the first file that imports it per fork
// (singleFork runs the whole suite in one process). Every later jsdom file
// would stack renders within itself and leak mounted trees into the files
// after it. Register cleanup here instead — setup runs per test file.
//
// The monorepo holds TWO RTL copies: server/node_modules (16.x, what this
// setup file resolves) and the hoisted root copy (14.x, what tests under
// ../packages/* resolve). cleanup() only unmounts trees tracked by its own
// copy, so clean both — otherwise package component tests stack renders
// ("Found multiple elements ...") while this hook faithfully cleans the
// copy they never used.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  loadRootRtl()?.cleanup?.();
});

// jsdom environments are REUSED across test files in this single-fork suite,
// and several tests mount via raw react-dom createRoot into document.body
// without unmounting — their leftovers surface in later files as duplicate
// rows/textboxes. Start every file with a clean body (per-file only, so
// within-file state is untouched).
beforeAll(() => {
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '';
  }
});

// Testing-library failure output prints the whole document; some suites build
// very large DOMs and a retrying waitFor re-prints them until the fork OOMs.
// Cap the dump. (An explicit env wins, so local debugging can raise it.)
process.env.DEBUG_PRINT_LIMIT = process.env.DEBUG_PRINT_LIMIT || '10000';

// configure({ testIdAttribute }) mutates GLOBAL Testing Library state and the
// suite shares one fork — reset it after every test, against both RTL copies
// (see the dual-copy note on the cleanup hook below).
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { configure } = await import('@testing-library/react');
  configure({ testIdAttribute: 'data-testid' });
  loadRootRtl()?.configure?.({ testIdAttribute: 'data-testid' });
});

// Edition-gated suites set EDITION / NEXT_PUBLIC_EDITION per test and not all
// restore; in the shared fork a leaked edition flips later suites' code paths
// (Temporal-vs-PgBoss SLA backend, Microsoft consumer availability, ...).
// Baseline is captured in beforeAll — AFTER the test module's top-level code —
// so files that legitimately set the edition at module scope (and restore in
// their own afterAll) keep working; per-test setters are reset every test.
// Two baselines, because the two hazards pull in opposite directions:
//  - TEST baseline (captured in beforeEach, which runs before the file's own
//    beforeEach because setup hooks register first): whatever module-scope
//    and beforeAll code established stays put, while setters that run inside
//    a test get reset between tests.
//  - FORK baseline (captured the first time this setup runs in the process):
//    restored when the file finishes, so a module-scope setter can't leak its
//    edition into every later file in the shared fork.
// Guarded vars: EDITION flips Temporal-vs-PgBoss and CE/EE dispatch; the
// base-URL trio feeds getEmailWebhookBaseUrl and friends (a leaked
// localhost NEXTAUTH_URL makes webhook probes silently enter polling mode);
// the MICROSOFT_*_BASE_URL overrides swap Graph or the OAuth authority for an emulator —
// no test file sets those, but server/knexfile.cjs opens with
// require('dotenv').config(), so the first suite that reaches it (e.g. the
// search-backfill script) dumps the developer's whole server/.env into the
// shared fork and every later Microsoft OAuth assertion reads the emulator.
// TZ shifts every date the process formats — a timezone test that sets it
// and doesn't restore turns later files' date assertions off by a day.
const GUARDED_ENV_VARS = [
  'EDITION',
  'NEXT_PUBLIC_EDITION',
  'APPLICATION_URL',
  'NEXTAUTH_URL',
  'NEXT_PUBLIC_BASE_URL',
  'MICROSOFT_LOGIN_BASE_URL',
  'MICROSOFT_GRAPH_BASE_URL',
  'MICROSOFT_GRAPH_BETA_BASE_URL',
  'TZ',
] as const;
type GuardedEnvVar = (typeof GUARDED_ENV_VARS)[number];

const FORK_ENV_KEY = Symbol.for('alga.test.forkEditionBaseline');
const forkBaseline = ((globalThis as any)[FORK_ENV_KEY] ??= Object.fromEntries(
  GUARDED_ENV_VARS.map((key) => [key, process.env[key]])
)) as Partial<Record<GuardedEnvVar, string | undefined>>;

const restoreEnv = (key: GuardedEnvVar, value: string | undefined) => {
  if (process.env[key] === value) return;
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

let testEnvBaseline: Partial<Record<GuardedEnvVar, string | undefined>> = {};
beforeEach(() => {
  testEnvBaseline = Object.fromEntries(
    GUARDED_ENV_VARS.map((key) => [key, process.env[key]])
  );
});
afterAll(() => {
  for (const key of GUARDED_ENV_VARS) {
    restoreEnv(key, forkBaseline[key]);
  }
  // Per-file stubGlobal hygiene: a file that stubs a global (e.g. a gutted
  // `navigator` for clipboard tests) and never unstubs leaks it to every
  // later file in the shared fork. In-file persistence is preserved — this
  // only runs after the file's own tests finish.
  vi.unstubAllGlobals();
});
afterEach(() => {
  for (const key of GUARDED_ENV_VARS) {
    restoreEnv(key, testEnvBaseline[key]);
  }
});

// Several suites replace global fetch (vi.stubGlobal or direct assignment)
// and never restore it — in the shared fork every later file then calls a
// mock that resolves undefined ("Cannot read properties of undefined
// (reading 'json')" from real HTTP tests like the emulator smokes). Restore
// after every test to the per-file baseline (captured in beforeAll so files
// that stub fetch at module scope keep their stub through the file).
let realFetch: typeof globalThis.fetch;
beforeAll(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  if (globalThis.fetch !== realFetch) {
    globalThis.fetch = realFetch;
  }
});

// Node 25 ships an experimental global localStorage that shadows jsdom's and
// throws/no-ops without --localstorage-file ("setItem is not a function").
// CI's Node 20 has no such global; guard local runs with a Map-backed stub.
if (typeof window !== 'undefined') {
  let broken = false;
  try {
    broken = typeof window.localStorage?.setItem !== 'function';
    if (!broken) {
      window.localStorage.setItem('__probe__', '1');
      window.localStorage.removeItem('__probe__');
    }
  } catch {
    broken = true;
  }
  if (broken) {
    const backing = new Map<string, string>();
    const storage = {
      get length() { return backing.size; },
      clear: () => backing.clear(),
      getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
      key: (i: number) => [...backing.keys()][i] ?? null,
      removeItem: (k: string) => { backing.delete(k); },
      setItem: (k: string, v: string) => { backing.set(k, String(v)); },
    } as Storage;
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  }
}

// jsdom does not implement matchMedia; responsive components query it on
// mount. Same guarded polyfill the package-level vitest setups use.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

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
//
// Defined via vi.hoisted: the mock factory below can fire while this file's
// const section is still evaluating (seen in CI when a jsdom environment
// re-init imported keyboard-shortcuts/display mid-setup), and plain top-level
// consts are TDZ at that point. vi.hoisted runs before any import executes,
// so the factory can never observe these uninitialized.
const i18nMocks = vi.hoisted(() => {
  const mockT = (
    _key: string,
    options?: string | { defaultValue?: string; [key: string]: unknown },
    params?: { [key: string]: unknown }
  ) => {
    // Support both call forms: t(key, {defaultValue, ...vars}) and
    // t(key, 'default string', {...vars}).
    const template = typeof options === 'string' ? options : (options?.defaultValue ?? _key);
    const vars = typeof options === 'string' ? params : options;
    return template.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) => {
      const value = vars?.[name];
      return value === undefined ? match : String(value);
    });
  };
  const mockI18n = { language: 'en' };

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

  return {
    mockT,
    mockI18n,
    mockUseTranslation: () => ({ t: mockT, i18n: mockI18n }),
    mockFormatters,
    mockUseFormatters: () => mockFormatters,
    // Stable i18n context value used by useI18n/useOptionalI18n (locale-aware
    // shared components like DatePicker/CurrencyInput read this).
    mockI18nContext: { locale: 'en', t: mockT, i18n: mockI18n },
  };
});
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: i18nMocks.mockUseTranslation,
  useFormatters: i18nMocks.mockUseFormatters,
  useI18n: () => i18nMocks.mockI18nContext,
  useOptionalI18n: () => i18nMocks.mockI18nContext,
  detectClientLocale: () => 'en',
  // I18nWrapper renders this while it resolves the locale; without it every
  // test that mounts a page through the wrapper throws on the missing export.
  getBootstrapLoadingText: () => 'Loading...',
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('next/server', async () => {
  const mod = await import('./stubs/next-server');
  return mod;
});

vi.mock('server/src/app/api/auth/[...nextauth]/edge-auth', () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

vi.mock('@alga-psa/auth', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');

  const defaultUser = {
    user_id: '00000000-0000-0000-0000-000000000001',
    tenant: '00000000-0000-0000-0000-000000000001',
    roles: [],
  };

  // Mirrors packages/auth apiKeyUserContext: API routes wrap handlers in
  // runWithApiKeyUser and getCurrentUser() prefers the override.
  const apiKeyUserStorage = new AsyncLocalStorage<any>();
  const runWithApiKeyUser = (user: any, fn: () => Promise<any>) =>
    apiKeyUserStorage.run(user, fn);
  const getApiKeyUserOverride = () => apiKeyUserStorage.getStore();

  const getCurrentUser = vi.fn(async () => getApiKeyUserOverride() ?? defaultUser);
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

  // Every name that production code value-imports from '@alga-psa/auth' must
  // exist here — a missing one makes vitest throw at the import binding and
  // every API test 500s (see the runWithApiKeyUser nightly break). The
  // authGlobalMock contract test enumerates prod imports and enforces this.
  return {
    getSession: vi.fn().mockResolvedValue(null),
    getSessionWithRevocationCheck: vi.fn().mockResolvedValue(null),
    getCurrentUser,
    hasPermission,
    withAuth,
    withAuthCheck,
    withOptionalAuth,
    runWithApiKeyUser,
    getApiKeyUserOverride,
    getSessionCookieName: vi.fn(() => 'authjs.session-token'),
    getNextAuthSecret: vi.fn(async () => 'test-nextauth-secret'),
    formatRateLimitError: vi.fn(async () => 'Too many attempts. Please try again later.'),
    checkPortalInvitationLimit: vi.fn(async () => undefined),
    verifyAuthenticator: vi.fn(async () => false),
    registerAuthEmailProvider: vi.fn(),
    preCheckDeletion: vi.fn(async () => ({ canDelete: true })),
    buildSessionCookie: vi.fn(() => ({ name: 'authjs.session-token', value: 'test-session', options: {} })),
    consumePortalDomainOtt: vi.fn(async () => null),
    encodePortalSessionToken: vi.fn(async () => 'test-portal-session-token'),
    generateDeviceFingerprint: vi.fn(() => 'test-device-fingerprint'),
    getClientIp: vi.fn(() => '127.0.0.1'),
    getDeviceInfo: vi.fn(() => ({})),
    getLocationFromIp: vi.fn(async () => null),
    getSessionMaxAge: vi.fn(() => 60 * 60 * 24),
    ApiKeyService: {
      generateApiKey: vi.fn(() => 'test-api-key'),
      createApiKey: vi.fn(),
      validateApiKey: vi.fn(async () => null),
      deactivateApiKey: vi.fn(),
      listUserApiKeys: vi.fn(async () => []),
      listAllApiKeys: vi.fn(async () => []),
    },
    PasswordResetService: {
      generateSecureToken: vi.fn(() => 'test-reset-token'),
      hashToken: vi.fn((token: string) => `hashed:${token}`),
      createResetToken: vi.fn(),
      createResetTokenWithTransaction: vi.fn(),
      verifyToken: vi.fn(async () => ({ valid: false })),
      markTokenAsUsed: vi.fn(async () => false),
    },
  };
});
