/**
 * Hudu asset-import helpers (F215/F216, EE-only).
 *
 * Kept out of the actions file so tests can assert the tag/status rules
 * directly. The status default mirrors the manual create form (OQ2:
 * QuickAddAsset.tsx initializes formData.status = 'active'); the tag
 * pre-check is app-level courtesy — assets.asset_tag has no unique
 * constraint (OQ2 resolution in the Phase 2 scratchpad).
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** F216: same default asset status as the manual create form. */
export function huduImportAssetStatus(): string {
  return 'active';
}

export interface DeriveHuduAssetTagInput {
  huduAssetId: string | number;
  primarySerial?: string | null;
}

/**
 * F215: primary_serial when non-blank AND no asset in the tenant already
 * uses it as asset_tag; otherwise `hudu-<hudu asset id>`.
 */
export async function deriveHuduAssetTag(
  knex: Knex,
  tenant: string,
  input: DeriveHuduAssetTagInput
): Promise<string> {
  const serial = (input.primarySerial ?? '').trim();
  if (serial) {
    const taken = await tenantDb(knex, tenant).table('assets').where({ asset_tag: serial }).first('asset_id');
    if (!taken) return serial;
  }
  return `hudu-${input.huduAssetId}`;
}
