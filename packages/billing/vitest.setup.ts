process.env.NEXTAUTH_SECRET ??= 'billing-vitest-only-secret';

if (typeof window !== 'undefined') {
  // CI runs the affected nx projects in parallel, so a saturated runner can
  // stretch renders past testing-library's 1s default async timeout (waitFor,
  // findBy*) and flake component suites that pass everywhere else. Genuinely
  // failing waits just take longer to report; passing waits are unaffected.
  const { configure } = await import('@testing-library/dom');
  configure({ asyncUtilTimeout: 10_000 });

  const storage = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key) => {
      storage.delete(key);
    },
    setItem: (key, value) => {
      storage.set(key, String(value));
    },
  };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorageMock,
  });
}
