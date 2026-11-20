/**
 * Server-derived co-managed access (commercial eligibility, capacity, permissions) can change when a
 * purchase is verified. Surfaces that cache it client-side (the sidebar) listen for this event and
 * re-read from the server; nothing here raises capacity, it only asks for a fresh authenticated read.
 */
export const CO_MANAGED_ACCESS_CHANGED = 'alga:co-managed-access-changed';

export function announceCoManagedAccessChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CO_MANAGED_ACCESS_CHANGED));
}
