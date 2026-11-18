/**
 * Deterministic ordering for an entity's associated assets: newest association first
 * (so a just-received item is within the Assets panel's collapsed rows), ties broken by asset_id.
 * alga-2026-0002683 C4 follow-up 1/3.
 */
export interface EntityAssociationRow {
  asset_id: string;
  created_at?: Date | string | null;
}

function toMillis(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

export function orderEntityAssetIds(
  associations: EntityAssociationRow[],
  authorizedAssetIds: Iterable<string>,
): string[] {
  const allowed = new Set(authorizedAssetIds);
  const seen = new Set<string>();
  return [...associations]
    .sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at) || a.asset_id.localeCompare(b.asset_id))
    .map((row) => row.asset_id)
    .filter((id) => allowed.has(id) && !seen.has(id) && !!seen.add(id));
}
