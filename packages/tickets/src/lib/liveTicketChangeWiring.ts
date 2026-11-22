import type { ChangedSinceLoad } from './changedSinceLoad';
import type { TicketListChange } from './listChangeFilters';

/**
 * Keep search reconciliation independent from in-memory classification.
 * Indexed search membership and board indicators can change even when a
 * repeated or otherwise unclassifiable event does not alter the current state.
 */
export function handleTicketListChangeForDashboard(
  event: TicketListChange,
  state: ChangedSinceLoad,
  searchQuery: string,
  onStateChanged: () => void,
  reconcileCounts: () => void,
): boolean {
  const changed = state.record(event);
  if (changed) onStateChanged();
  if (state.hasFallback() || searchQuery.trim()) reconcileCounts();
  return changed;
}
