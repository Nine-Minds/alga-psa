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
 * Returns an SWR key filter, for `useSWRConfig().mutate(filter)`.
 */
export function matchAssetCacheKeys(
  assetIds: readonly (string | null | undefined)[]
): (key: unknown) => boolean {
  const wanted = new Set(assetIds.filter((id): id is string => Boolean(id)));
  return (key: unknown): boolean =>
    Array.isArray(key) &&
    key[0] === 'asset' &&
    typeof key[1] === 'string' &&
    wanted.has(key[1]);
}
