/**
 * The seat allocation an administrator asked for while the pool was short, kept in the browser across
 * the checkout round-trip (a reload, a redirect-based payment method, a second tab). It holds the request
 * and the identity of the two idempotent operations (the allocation and the purchase); it grants nothing.
 * Capacity is always re-read, so a stale or lost intent costs a re-entry, never a charge.
 */
export interface CoManagedSeatAllocationIntent {
  clientId: string;
  /** Idempotency key of the allocation command; kept so completion after a purchase is replay-safe. */
  operationId: string;
  seats: number;
  contactId: string;
  boards: Array<{ boardId: string; canCreate: boolean }>;
  /** The pool purchase started for this intent, once one has been. */
  purchase: { operationId: string; quantity: number } | null;
  savedAt: number;
}

// LEVERAGE: friction pending-intent-browser-storage — a pending allocation has no server-side record, so it lives in this browser; a second device or a cleared profile re-enters the request (the purchase itself is safe, it is keyed server-side). A durable per-client intent beside co_managed_purchase_operations would remove this.
const PREFIX = 'co-managed-seat-intent:';
export const COMANAGED_SEAT_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

const browserStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

export function readSeatAllocationIntent(clientId: string, storage = browserStorage(), now = Date.now()): CoManagedSeatAllocationIntent | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PREFIX + clientId);
    if (!raw) return null;
    const value = JSON.parse(raw) as CoManagedSeatAllocationIntent;
    const valid = value && value.clientId === clientId && typeof value.operationId === 'string' && Number.isInteger(value.seats) &&
      typeof value.contactId === 'string' && Array.isArray(value.boards) && typeof value.savedAt === 'number';
    if (!valid || now - value.savedAt > COMANAGED_SEAT_INTENT_TTL_MS) { storage.removeItem(PREFIX + clientId); return null; }
    return { ...value, purchase: value.purchase ?? null };
  } catch { return null; }
}

export function writeSeatAllocationIntent(intent: Omit<CoManagedSeatAllocationIntent, 'savedAt'>, storage = browserStorage(), now = Date.now()): void {
  try { storage?.setItem(PREFIX + intent.clientId, JSON.stringify({ ...intent, savedAt: now })); } catch { /* storage unavailable: the flow still works for this page view */ }
}

export function clearSeatAllocationIntent(clientId: string, storage = browserStorage()): void {
  try { storage?.removeItem(PREFIX + clientId); } catch { /* nothing to clear */ }
}
