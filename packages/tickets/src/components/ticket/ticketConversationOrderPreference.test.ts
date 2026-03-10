// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from 'vitest';
import {
  getStoredTicketConversationNewestFirst,
  setStoredTicketConversationNewestFirst,
  TICKET_CONVERSATION_ORDER_STORAGE_KEY,
} from './ticketConversationOrderPreference';

const localStorageState = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => localStorageState.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageState.set(key, value);
  },
  removeItem: (key: string) => {
    localStorageState.delete(key);
  },
  clear: () => {
    localStorageState.clear();
  },
};

describe('ticketConversationOrderPreference', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
  });

  it('falls back to the provided default when storage is empty', () => {
    expect(getStoredTicketConversationNewestFirst(true)).toBe(true);
    expect(getStoredTicketConversationNewestFirst(false)).toBe(false);
  });

  it('returns the stored boolean preference', () => {
    setStoredTicketConversationNewestFirst(true);
    expect(getStoredTicketConversationNewestFirst(false)).toBe(true);
  });

  it('falls back to the provided default when storage contains invalid data', () => {
    window.localStorage.setItem(TICKET_CONVERSATION_ORDER_STORAGE_KEY, '"unexpected"');
    expect(getStoredTicketConversationNewestFirst(false)).toBe(false);
  });
});
