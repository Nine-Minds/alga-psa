export const TICKET_CONVERSATION_ORDER_STORAGE_KEY = 'ticketConversationNewestFirst';

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getStoredTicketConversationNewestFirst(defaultValue: boolean): boolean {
  if (!canUseLocalStorage()) {
    return defaultValue;
  }

  try {
    const storedValue = window.localStorage.getItem(TICKET_CONVERSATION_ORDER_STORAGE_KEY);
    if (storedValue === null) {
      return defaultValue;
    }

    if (storedValue === 'true' || storedValue === 'false') {
      return storedValue === 'true';
    }

    const parsedValue = JSON.parse(storedValue);
    return typeof parsedValue === 'boolean' ? parsedValue : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function setStoredTicketConversationNewestFirst(value: boolean): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(TICKET_CONVERSATION_ORDER_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures so the UI continues to work even when persistence is unavailable.
  }
}
