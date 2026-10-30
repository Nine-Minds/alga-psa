'use server';

import { z } from 'zod';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import {
  getAssetWarrantySummary as getAssetWarrantySummaryRead,
  getRmaBadgesForAssets,
  type AssetRmaBadge,
  type AssetWarrantySummary,
} from '../lib/warranty/warrantyReads';

/**
 * Warranty reads for the asset screens (C5). Reads only. Gated by asset:read plus the record-level asset
 * check inside the read models; an unreadable asset answers as if it had nothing (null / empty), never an error.
 */

export interface AssetWarrantyCardData extends AssetWarrantySummary {
  /** Whether this user may start a warranty claim (warranty or inventory create, and asset update). */
  can_create_claim: boolean;
}

const idSchema = z.string().uuid();

export const getAssetWarrantySummary = withAuth(
  async (user, { tenant }, assetId: string): Promise<AssetWarrantyCardData | null> => {
    if (!idSchema.safeParse(assetId).success) return null;
    if (!(await hasPermission(user, 'asset', 'read'))) return null;
    const { knex } = await createTenantKnex();
    const summary = await getAssetWarrantySummaryRead(knex, tenant, user as any, assetId);
    if (!summary) return null;
    const canCreate =
      ((await hasPermission(user, 'warranty', 'create')) || (await hasPermission(user, 'inventory', 'create'))) &&
      (await hasPermission(user, 'asset', 'update'));
    return { ...summary, can_create_claim: canCreate };
  }
);

/** Open-RMA chips for a page of assets (list rows, a ticket's associated assets). */
export const getOpenRmaBadges = withAuth(
  async (user, { tenant }, assetIds: string[]): Promise<AssetRmaBadge[]> => {
    const parsed = z.array(idSchema).max(500).safeParse(assetIds);
    if (!parsed.success || parsed.data.length === 0) return [];
    if (!(await hasPermission(user, 'asset', 'read'))) return [];
    const { knex } = await createTenantKnex();
    return getRmaBadgesForAssets(knex, tenant, user as any, parsed.data);
  }
);
