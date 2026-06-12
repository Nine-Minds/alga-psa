'use client';

import { useEffect, useRef, useState } from 'react';
import type { AssetTypeRegistryEntry } from '@alga-psa/types';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { getAssetTypes } from '../../actions/assetTypeRegistryActions';

const BUILTIN_TYPE_SLUGS = [
  'workstation',
  'network_device',
  'server',
  'mobile_device',
  'printer',
  'unknown',
] as const;

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function defaultBuiltinLabel(slug: string): string {
  return slug
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function builtinAssetTypeLabel(t: TranslateFn, slug: string): string {
  return t(`quickAddAsset.assetTypes.${slug}`, { defaultValue: defaultBuiltinLabel(slug) });
}

/** F308: fetches the tenant asset-type registry once per mount (when enabled). */
export function useAssetTypeRegistry(enabled = true): AssetTypeRegistryEntry[] | null {
  const [entries, setEntries] = useState<AssetTypeRegistryEntry[] | null>(null);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!enabled || requestedRef.current) return;
    requestedRef.current = true;
    let mounted = true;
    getAssetTypes()
      .then((types) => {
        if (mounted) setEntries(types);
      })
      .catch((error) => {
        console.error('Error loading asset types:', error);
        if (mounted) setEntries([]);
      });
    return () => {
      mounted = false;
    };
  }, [enabled]);

  return entries;
}

/**
 * F308: type-select options — built-ins first (existing i18n labels), then
 * custom types (registry display name, in registry order). Falls back to the
 * hardcoded built-ins while the registry is loading or unavailable so the
 * form stays usable.
 */
export function buildAssetTypeOptions(
  entries: AssetTypeRegistryEntry[] | null,
  t: TranslateFn,
  opts: { includeUnknown?: boolean } = {}
): SelectOption[] {
  const includeUnknown = opts.includeUnknown ?? false;
  const builtinOptions = BUILTIN_TYPE_SLUGS
    .filter((slug) => includeUnknown || slug !== 'unknown')
    .map((slug) => ({ value: slug as string, label: builtinAssetTypeLabel(t, slug) }));

  const customOptions = (entries ?? [])
    .filter((entry) => !entry.is_builtin)
    .map((entry) => ({ value: entry.slug, label: entry.name }));

  return [...builtinOptions, ...customOptions];
}

/** Registry entry for a selected slug, but only when it is a custom type. */
export function findCustomAssetType(
  entries: AssetTypeRegistryEntry[] | null,
  slug: string | undefined | null
): AssetTypeRegistryEntry | null {
  if (!entries || !slug) return null;
  const entry = entries.find((candidate) => candidate.slug === slug);
  return entry && !entry.is_builtin ? entry : null;
}
