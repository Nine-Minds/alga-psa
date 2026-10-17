/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal asset status badge intentionally reuses the asset feature's status schema so labels and tones never drift from the MSP view. */

import type { AssetStatusKind } from '@alga-psa/types';
import type { BadgeVariant } from '@alga-psa/ui/components/Badge';
import { BUILTIN_ASSET_STATUSES, assetStatusLabelForSlug } from '@alga-psa/assets/lib/assetStatusSchema';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * F021 on the portal: a slug reads as its localized builtin label, else as the
 * tenant's own label for it, else as its humanized self ("in_repair" -> "In
 * repair"). Every portal surface shares this helper because they had drifted
 * apart: the list called everything that was not `inactive` "Active", so a
 * device in a custom status read "Active" in the table and "In repair" one
 * click away in its details.
 */
export function portalAssetStatusLabel(
  t: TranslateFn,
  status: string | null | undefined,
  label?: string | null,
): string {
  if (!status) return '';
  return t(`assets.statuses.${status}`, {
    defaultValue: label?.trim() || assetStatusLabelForSlug(status, null),
  });
}

type StatusTally = { readonly kind: AssetStatusKind; readonly count: number };

/**
 * FR-B5: how many of a client's devices are actually deployed, and which
 * statuses the rest are in. The banner used to read "active" as "not the
 * literal `inactive`", which announced all devices active with one in repair.
 */
export function tallyPortalDeviceStatuses<T extends StatusTally>(
  summaries: readonly T[],
): { deviceCount: number; activeCount: number; allActive: boolean; attention: T[] } {
  const deviceCount = summaries.reduce((sum, summary) => sum + summary.count, 0);
  const activeCount = summaries
    .filter((summary) => summary.kind === 'deployable')
    .reduce((sum, summary) => sum + summary.count, 0);
  return {
    deviceCount,
    activeCount,
    allActive: deviceCount > 0 && activeCount === deviceCount,
    attention: summaries.filter((summary) => summary.kind !== 'deployable' && summary.count > 0),
  };
}

/**
 * The badge tone follows the status kind — deployable reads well, undeployable
 * and archived read spent, and anything pending reads as something to ask
 * about. The kind comes from the tenant's registry when the caller knows it
 * (the device list is told per slug); otherwise only the builtins are known,
 * and an unexplained slug is worth asking about.
 */
export function portalAssetStatusVariant(
  status: string | null | undefined,
  kind?: AssetStatusKind | null,
): BadgeVariant {
  const resolved = kind ?? BUILTIN_ASSET_STATUSES.find((candidate) => candidate.slug === status)?.kind;
  if (resolved === 'deployable') return 'success';
  if (resolved === 'undeployable' || resolved === 'archived') return 'default-muted';
  return 'warning';
}
