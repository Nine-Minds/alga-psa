import type { BadgeVariant } from '@alga-psa/ui/components/Badge';
import { BUILTIN_ASSET_STATUSES, assetStatusLabelForSlug } from '@alga-psa/assets/lib/assetStatusSchema';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/**
 * F021 on the portal: the portal never reads the tenant's status registry, so
 * a slug reads as its localized builtin label and otherwise as its humanized
 * self ("in_repair" -> "In repair"). The device list and the details panel
 * share this helper because they had drifted apart: the list called everything
 * that was not `inactive` "Active", so a device in a custom status read
 * "Active" in the table and "In repair" one click away in its details.
 */
export function portalAssetStatusLabel(t: TranslateFn, status: string | null | undefined): string {
  if (!status) return '';
  return t(`assets.statuses.${status}`, {
    defaultValue: assetStatusLabelForSlug(status, null),
  });
}

/**
 * The badge tone follows the builtin status kind — deployable reads well,
 * undeployable and archived read spent, and anything the MSP invented reads as
 * something to ask about.
 */
export function portalAssetStatusVariant(status: string | null | undefined): BadgeVariant {
  const kind = BUILTIN_ASSET_STATUSES.find((candidate) => candidate.slug === status)?.kind;
  if (kind === 'deployable') return 'success';
  if (kind === 'undeployable' || kind === 'archived') return 'default-muted';
  return 'warning';
}
