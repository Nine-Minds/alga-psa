/**
 * Every asset surface caches under `['asset', assetId, ...]` — the record
 * itself, summary metrics, history, tickets, maintenance, notes, documents.
 *
 * A write that changes the record has to invalidate that whole fan, not just
 * the one key it happens to know about: the Bento detail page is entirely
 * client-rendered from those keys, so `router.refresh()` leaves it showing the
 * pre-save values until a full reload (the edit drawer saved a new status and
 * the Identity tile kept the old one).
 *
 * The ticket/project "Assets" panel caches the entity's association list under
 * `ticketAssetsKey(entityType, entityId)`. Pass the entity id alongside the
 * asset ids (`matchAssetCacheKeys([assetId, ticketId])`) to revalidate exactly
 * that panel and no other open entity's.
 *
 * Returns an SWR key filter, for `useSWRConfig().mutate(filter)`.
 */
export function matchAssetCacheKeys(
  assetIds: readonly (string | null | undefined)[]
): (key: unknown) => boolean {
  const wanted = new Set(assetIds.filter((id): id is string => Boolean(id)));
  return (key: unknown): boolean =>
    Array.isArray(key) &&
    ((key[0] === 'asset' && typeof key[1] === 'string' && wanted.has(key[1])) ||
      (key[0] === ENTITY_ASSETS_KEY && typeof key[2] === 'string' && wanted.has(key[2])));
}

const ENTITY_ASSETS_KEY = 'entity-assets';

/** Cache key for the assets associated with a ticket or project (the Assets panel). */
export const ticketAssetsKey = (entityType: string, entityId: string) =>
  [ENTITY_ASSETS_KEY, entityType, entityId] as const;

/**
 * Every mounted entity Assets panel. For writes that know the asset but not
 * which ticket/project is showing it (e.g. the asset's own custody card);
 * only panels currently mounted revalidate.
 */
export const matchAnyEntityAssetsKeys = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === ENTITY_ASSETS_KEY;
