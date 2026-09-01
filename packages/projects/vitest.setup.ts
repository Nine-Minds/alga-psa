// Node 22+ ships its own `localStorage` global; unconfigured it shadows jsdom's
// Storage with an object missing every method, so components that persist state
// throw on newer runtimes. Restore a working in-memory Storage when that happens.
// Mirrors packages/ui and packages/billing.
if (typeof window !== 'undefined' && typeof window.localStorage?.setItem !== 'function') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage });
}
