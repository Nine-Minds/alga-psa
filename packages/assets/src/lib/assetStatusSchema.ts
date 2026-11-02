import type { AssetStatus, AssetStatusKind } from '@alga-psa/types';

/** Must stay in step with the asset_statuses_kind_check constraint. */
export const ASSET_STATUS_KINDS: readonly AssetStatusKind[] = [
  'deployable',
  'pending',
  'undeployable',
  'archived',
];

/**
 * The six statuses every tenant starts with (FR-B2). Mirrors
 * server/migrations/20261009121000_create_asset_statuses.cjs and
 * ee/server/seeds/onboarding/psa/11_asset_statuses.cjs.
 */
export const BUILTIN_ASSET_STATUSES: ReadonlyArray<{
  slug: string;
  label: string;
  kind: AssetStatusKind;
  display_order: number;
}> = [
  { slug: 'active', label: 'Active', kind: 'deployable', display_order: 0 },
  { slug: 'in_stock', label: 'In stock', kind: 'deployable', display_order: 1 },
  { slug: 'maintenance', label: 'In maintenance', kind: 'pending', display_order: 2 },
  { slug: 'inactive', label: 'Inactive', kind: 'undeployable', display_order: 3 },
  { slug: 'retired', label: 'Retired', kind: 'archived', display_order: 4 },
  { slug: 'held_by_msp', label: 'Held by MSP', kind: 'pending', display_order: 5 },
];

export const BUILTIN_ASSET_STATUS_SLUGS = BUILTIN_ASSET_STATUSES.map((status) => status.slug);

export type AssetStatusRegistryError = {
  code: 'invalid_status' | 'invalid_kind' | 'duplicate_slug' | 'not_found' | 'unknown_status' | 'archived_status' | 'status_in_use';
  message: string;
  slug?: string;
  inUseCount?: number;
};

export type AssetStatusRegistryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AssetStatusRegistryError };

/** "In repair" -> "in_repair". Same shape as the builtin slugs. */
export function generateAssetStatusSlug(label: string): string {
  return String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/**
 * "in_repair" -> "In repair". The last-resort reading of a status slug, for
 * when the registry has not loaded yet and the slug is not a builtin: a
 * humanized slug is still better than the raw one on screen.
 */
export function humanizeAssetStatusSlug(slug: string): string {
  const words = String(slug ?? '').split('_').filter(Boolean);
  if (words.length === 0) return '';
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(' ');
}

/** The label for a status slug: registry row, else builtin, else humanized. */
export function assetStatusLabelForSlug(
  slug: string,
  statuses: ReadonlyArray<Pick<AssetStatus, 'slug' | 'label'>> | null | undefined
): string {
  const registered = statuses?.find((candidate) => candidate.slug === slug);
  if (registered?.label) return registered.label;
  const builtin = BUILTIN_ASSET_STATUSES.find((candidate) => candidate.slug === slug);
  if (builtin) return builtin.label;
  return humanizeAssetStatusSlug(slug);
}

/**
 * The lifecycle kind for a status slug: registry row, else builtin, else
 * `undeployable` — a slug nobody can explain is not something to call deployed.
 */
export function assetStatusKindForSlug(
  slug: string,
  statuses: ReadonlyArray<Pick<AssetStatus, 'slug' | 'kind'>> | null | undefined
): AssetStatusKind {
  const registered = statuses?.find((candidate) => candidate.slug === slug);
  if (registered?.kind) return registered.kind;
  return BUILTIN_ASSET_STATUSES.find((candidate) => candidate.slug === slug)?.kind ?? 'undeployable';
}

/** Options for a status select, grouped by lifecycle kind in kind order. */
export function groupAssetStatusesByKind(
  statuses: AssetStatus[]
): Array<{ kind: AssetStatusKind; statuses: AssetStatus[] }> {
  return ASSET_STATUS_KINDS
    .map((kind) => ({ kind, statuses: statuses.filter((status) => status.kind === kind) }))
    .filter((group) => group.statuses.length > 0);
}
