'use client';

import { useEffect, useRef, useState } from 'react';
import type { AssetStatus } from '@alga-psa/types';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { listAssetStatuses } from '../../actions/assetStatusActions';
import {
  getErrorMessage,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { assetStatusLabel } from '../../lib/assetStatus';
import {
  BUILTIN_ASSET_STATUSES,
  assetStatusLabelForSlug,
  groupAssetStatusesByKind,
  humanizeAssetStatusSlug,
} from '../../lib/assetStatusSchema';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * FR-B2 fallback: while the registry is loading (or the user cannot read it)
 * the selects still offer the five builtins so a form is never unusable.
 */
function fallbackStatuses(): AssetStatus[] {
  return BUILTIN_ASSET_STATUSES.map((status, index) => ({
    tenant: '',
    status_id: `builtin_${status.slug}`,
    slug: status.slug,
    label: status.label,
    kind: status.kind,
    is_builtin: true,
    is_active: true,
    display_order: status.display_order ?? index,
    created_at: '',
    updated_at: '',
  }));
}

/** FR-B3: the tenant's status list, fetched once per mount when enabled. */
export function useAssetStatusRegistry(
  enabled = true,
  options?: { includeArchived?: boolean; withUsage?: boolean }
): { statuses: AssetStatus[] | null; reload: () => void } {
  const [statuses, setStatuses] = useState<AssetStatus[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestedRef = useRef(-1);
  const includeArchived = options?.includeArchived ?? false;
  const withUsage = options?.withUsage ?? false;

  useEffect(() => {
    if (!enabled || requestedRef.current === nonce) return;
    requestedRef.current = nonce;
    let mounted = true;
    listAssetStatuses({ includeArchived, withUsage })
      .then((rows) => {
        if (!mounted) return;
        if (isActionPermissionError(rows)) {
          console.warn('Unable to load asset statuses:', getErrorMessage(rows));
          setStatuses([]);
          return;
        }
        setStatuses(rows);
      })
      .catch((error) => {
        console.error('Error loading asset statuses:', error);
        if (mounted) setStatuses([]);
      });
    return () => {
      mounted = false;
    };
  }, [enabled, nonce, includeArchived, withUsage]);

  return { statuses, reload: () => setNonce((value) => value + 1) };
}

/**
 * Status-select options grouped by lifecycle kind.
 *
 * Archived statuses are never offered — the server refuses them (FR-B3), so
 * listing one only lets the operator pick a value that cannot be saved. The
 * asset's current status is appended when it is not in the offered list, which
 * is how a device already sitting on an archived status still reads correctly.
 */
export function buildAssetStatusOptions(
  statuses: AssetStatus[] | null,
  t: TranslateFn,
  currentSlug?: string | null
): SelectOption[] {
  const all = statuses === null || statuses.length === 0 ? fallbackStatuses() : statuses;
  const rows = all.filter((status) => status.is_active);
  const options: SelectOption[] = [];

  for (const group of groupAssetStatusesByKind(rows)) {
    for (const status of group.statuses) {
      options.push({
        value: status.slug,
        label: assetStatusLabel(t, status),
        // The group label travels with the option so a grouped renderer can use
        // it and a plain select simply ignores it.
        ...({ groupLabel: t(`assetStatusKinds.${group.kind}`, { defaultValue: group.kind }) } as Record<string, unknown>),
      });
    }
  }

  if (currentSlug && !options.some((option) => option.value === currentSlug)) {
    options.push({
      value: currentSlug,
      label: assetStatusLabel(t, currentSlug, all),
    });
  }

  return options;
}
