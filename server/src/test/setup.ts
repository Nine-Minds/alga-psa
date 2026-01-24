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

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn().mockResolvedValue(null),
}));
