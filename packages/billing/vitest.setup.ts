process.env.NEXTAUTH_SECRET ??= 'billing-vitest-only-secret';

if (typeof window !== 'undefined') {
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
