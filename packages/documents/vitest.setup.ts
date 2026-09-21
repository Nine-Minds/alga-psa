import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

if (typeof window !== 'undefined') {
  // Node 22+ ships its own `localStorage` global; unconfigured it shadows
  // jsdom's Storage with an object missing every method. Restore a working
  // in-memory Storage, mirroring packages/projects and packages/ui.
  if (typeof window.localStorage?.setItem !== 'function') {
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

  // @testing-library/react's module-level auto-cleanup can be skipped when the
  // module is externalized; register cleanup per test file so mounted trees do
  // not leak across cases (e.g. leaving an open uploader behind).
  afterEach(async () => {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  });
}
