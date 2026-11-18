/* @vitest-environment jsdom */

/**
 * The shared Text / Email view mode: one value for every message body on the
 * page, seeded from localStorage so a reload keeps the reader's choice.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageState = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageState.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageState.set(key, value);
  },
  removeItem: (key: string) => {
    storageState.delete(key);
  },
  clear: () => {
    storageState.clear();
  },
};

const KEY = 'ticket_email_view_mode';

// The store caches its hydration, so each case needs a fresh module.
async function loadStore(stored?: string) {
  storageState.clear();
  if (stored !== undefined) storageState.set(KEY, stored);
  vi.resetModules();
  return import('./inboundEmailViewMode');
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
  storageState.clear();
});

describe('inbound email view mode store', () => {
  it('uses the key the user-preference actions write', async () => {
    const store = await loadStore();
    expect(store.INBOUND_EMAIL_VIEW_MODE_SETTING).toBe(KEY);
  });

  it('defaults to the stored text body when nothing is remembered', async () => {
    const store = await loadStore();
    expect(store.getInboundEmailViewMode()).toBe('text');
  });

  it('starts in the remembered mode', async () => {
    const store = await loadStore('"email"');
    expect(store.getInboundEmailViewMode()).toBe('email');
  });

  it('ignores a stored value it does not recognise', async () => {
    const store = await loadStore('"something-else"');
    expect(store.getInboundEmailViewMode()).toBe('text');
  });

  it('remembers a switch and tells every subscriber once', async () => {
    const store = await loadStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeInboundEmailViewMode(listener);

    store.setInboundEmailViewMode('email');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getInboundEmailViewMode()).toBe('email');
    expect(storageState.get(KEY)).toBe('"email"');

    // Re-selecting the current mode is not a change.
    store.setInboundEmailViewMode('email');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.setInboundEmailViewMode('text');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storageState.get(KEY)).toBe('"text"');
  });

  it('still switches when storage is unavailable', async () => {
    const store = await loadStore();
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
      configurable: true,
    });

    expect(() => store.setInboundEmailViewMode('email')).not.toThrow();
    expect(store.getInboundEmailViewMode()).toBe('email');
  });
});
