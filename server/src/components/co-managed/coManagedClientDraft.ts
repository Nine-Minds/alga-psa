/** Session-scoped draft for a client's desired allocation. It carries no
 * payment secret, invitation token, or authority — only the operator's typed
 * seat count — and expires so a stale draft cannot outlive the session. */
export interface CoManagedClientDraft {
  seats: number;
  relationshipId: string | null;
  updatedAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const storageKey = (clientId: string, relationshipId?: string | null) =>
  `coManaged:clientDraft:${clientId}:${relationshipId ?? 'none'}`;

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; }
  catch { return null; }
}

export function readCoManagedClientDraft(clientId: string, relationshipId?: string | null): number | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(storageKey(clientId, relationshipId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as CoManagedClientDraft;
    if (!Number.isInteger(draft.seats) || draft.seats < 1 || Date.now() - draft.updatedAt > TTL_MS) {
      store.removeItem(storageKey(clientId, relationshipId));
      return null;
    }
    return draft.seats;
  } catch { return null; }
}

export function writeCoManagedClientDraft(clientId: string, relationshipId: string | null | undefined, seats: number): void {
  const store = storage();
  if (!store || !Number.isInteger(seats) || seats < 1) return;
  try {
    store.setItem(storageKey(clientId, relationshipId),
      JSON.stringify({ seats, relationshipId: relationshipId ?? null, updatedAt: Date.now() } satisfies CoManagedClientDraft));
  } catch { /* storage unavailable */ }
}

export function clearCoManagedClientDraft(clientId: string, relationshipId?: string | null): void {
  const store = storage();
  if (!store) return;
  try { store.removeItem(storageKey(clientId, relationshipId)); } catch { /* storage unavailable */ }
}
