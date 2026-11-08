import type { CoManagedClientManagementView, CoManagedClientRelationshipView } from '@alga-psa/co-managed';

/**
 * The client record's co-managed phase, resolved once so the header summary,
 * the tab title and the status card cannot disagree. Pure: no capability read,
 * no authority derivation. Whether setup may be offered is the view's own
 * `canSetUp`; this only says which state the relationship is in.
 *
 * Precedence: absent → attention → not_enabled → selection_required → ended → live.
 */
export type ClientRelationshipPhase =
  | { kind: 'absent' }
  | { kind: 'attention' }
  | { kind: 'not_enabled' }
  | { kind: 'selection_required'; multiple: boolean; historyRelationshipId: string | null }
  | { kind: 'ended'; relationship: CoManagedClientRelationshipView }
  | { kind: 'live'; relationship: CoManagedClientRelationshipView };

export function resolveClientRelationshipSummary(
  view: CoManagedClientManagementView | null | undefined,
  selectedRelationshipId?: string | null,
): ClientRelationshipPhase {
  if (!view) return { kind: 'absent' };
  const selected = view.relationships.find(
    (entry) => entry.relationshipId === (selectedRelationshipId ?? view.selectedRelationshipId)) ?? null;
  const live = view.relationships.filter((entry) => !entry.ended);
  // A setup whose record names another sponsor or client is not "not enabled".
  if (!selected && view.inconsistent && live.length === 0) return { kind: 'attention' };
  // Nothing live or retained: a cancelled setup does not count.
  const nothingHeld = !view.inconsistent && view.relationships.every((entry) => entry.ended && !entry.retained);
  if (!selected && nothingHeld) return { kind: 'not_enabled' };
  if (view.selectionRequired) {
    return {
      kind: 'selection_required',
      multiple: live.length > 1,
      historyRelationshipId: view.relationships[0]?.relationshipId ?? null,
    };
  }
  if (!selected) return { kind: 'absent' };
  return selected.ended ? { kind: 'ended', relationship: selected } : { kind: 'live', relationship: selected };
}
