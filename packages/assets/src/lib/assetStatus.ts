import { useCallback } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { AssetStatus } from '@alga-psa/types';
import {
  BUILTIN_ASSET_STATUSES,
  BUILTIN_ASSET_STATUS_SLUGS,
  assetStatusLabelForSlug,
  humanizeAssetStatusSlug,
} from './assetStatusSchema';

/**
 * The one reading of an asset status on screen. Every surface (ticket Assets
 * panel, asset list, detail, client assets, quick-add) goes through here, so a
 * status added to the builtin list cannot print as a raw slug on one of them.
 * The locale coverage test enumerates `ASSET_STATUSES` against every locale.
 */

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/** The statuses every tenant has; each needs an `assetStatuses.<slug>` key in `msp/assets`. */
export const ASSET_STATUSES: readonly string[] = BUILTIN_ASSET_STATUS_SLUGS;

/** i18n key (namespace `msp/assets`) for a builtin status. */
export const assetStatusKey = (slug: string) => `assetStatuses.${slug}`;

/**
 * Label for a status. The tenant registry label is the source of truth (a
 * rename is allowed, FR-B4); a builtin that still carries its shipped label is
 * translated; anything else falls back to the humanized slug, never the raw one.
 */
export function assetStatusLabel(
  t: TranslateFn,
  status: string | null | undefined | { slug: string; label: string },
  registry?: ReadonlyArray<Pick<AssetStatus, 'slug' | 'label'>> | null
): string {
  if (!status) return '';
  const row =
    typeof status === 'string' ? { slug: status, label: assetStatusLabelForSlug(status, registry) } : status;
  const builtin = BUILTIN_ASSET_STATUSES.find((candidate) => candidate.slug === row.slug);
  if (builtin && (!row.label || row.label === builtin.label)) {
    return t(assetStatusKey(row.slug), { defaultValue: builtin.label });
  }
  return row.label || humanizeAssetStatusSlug(row.slug);
}

/** `(slug) => label`, bound to the current language and (optionally) the tenant registry. */
export function useAssetStatusLabel(
  registry?: ReadonlyArray<Pick<AssetStatus, 'slug' | 'label'>> | null
): (slug: string | null | undefined) => string {
  const { t } = useTranslation('msp/assets');
  return useCallback((slug) => assetStatusLabel(t as TranslateFn, slug, registry), [t, registry]);
}
