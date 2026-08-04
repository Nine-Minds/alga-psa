import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node 22+ ships its own `localStorage` global; when it is unconfigured it
// shadows jsdom's Storage with an object whose methods are missing, so any
// component that persists state blows up on newer runtimes. Put a working
// in-memory Storage back when that happens.
if (typeof window !== 'undefined' && typeof window.localStorage?.setItem !== 'function') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage });
}

// jsdom environments are reused across test files, so components left mounted
// by one file (Radix focus traps especially) steal focus from the next file's
// tests. RTL auto-cleanup only activates with `globals: true`; run it here.
afterEach(() => {
  cleanup();
});
