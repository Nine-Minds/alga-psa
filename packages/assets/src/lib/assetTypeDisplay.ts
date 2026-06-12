import type { AssetTypeRegistryEntry } from '@alga-psa/types';

/**
 * F314: single source for resolving an asset_type slug to a display label on
 * read surfaces (list column, filter options/pills, dashboard breakdown,
 * print/export columns). Built-in slugs are usually short-circuited to their
 * i18n labels by callers; anything else resolves through the tenant registry
 * and falls back to the historical title-cased slug.
 */

/** The pre-registry fallback: 'door_access' -> 'Door Access'. */
export function fallbackAssetTypeLabel(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Registry display name for the slug, else the title-cased fallback. */
export function resolveAssetTypeLabel(
  registry: readonly AssetTypeRegistryEntry[] | null | undefined,
  slug: string
): string {
  const entry = registry?.find((candidate) => candidate.slug === slug);
  if (entry && entry.name.trim().length > 0) {
    return entry.name;
  }
  return fallbackAssetTypeLabel(slug);
}
