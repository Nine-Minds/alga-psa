import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_PURGE_FLAG_KEY,
  LEGACY_TICKET_TIMER_DB_NAME,
  purgeLegacyTicketTimerStore,
} from '../purgeLegacyTicketTimerStore';

function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return store;
}

function stubIndexedDb() {
  const request: { onsuccess?: () => void; onblocked?: () => void } = {};
  const deleteDatabase = vi.fn(() => request);
  vi.stubGlobal('indexedDB', { deleteDatabase });
  return { request, deleteDatabase };
}

describe('purgeLegacyTicketTimerStore', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('is a no-op without browser storage APIs (SSR)', () => {
    expect(() => purgeLegacyTicketTimerStore()).not.toThrow();
  });

  it('deletes the legacy database and sets the flag once the delete succeeds', () => {
    const store = stubStorage();
    const { request, deleteDatabase } = stubIndexedDb();

    purgeLegacyTicketTimerStore();
    expect(deleteDatabase).toHaveBeenCalledWith(LEGACY_TICKET_TIMER_DB_NAME);
    expect(store.has(LEGACY_PURGE_FLAG_KEY)).toBe(false);

    request.onsuccess?.();
    expect(store.get(LEGACY_PURGE_FLAG_KEY)).toBe('1');
  });

  it('does not delete again once flagged', () => {
    const store = stubStorage();
    store.set(LEGACY_PURGE_FLAG_KEY, '1');
    const { deleteDatabase } = stubIndexedDb();

    purgeLegacyTicketTimerStore();
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it('swallows errors from the browser APIs', () => {
    stubStorage();
    vi.stubGlobal('indexedDB', { deleteDatabase: () => { throw new Error('denied'); } });
    expect(() => purgeLegacyTicketTimerStore()).not.toThrow();
  });
});
