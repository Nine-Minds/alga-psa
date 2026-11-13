/**
 * Hudu asset-import helpers (F215/F216, EE-only).
 *
 * Kept out of the actions file so tests can assert the tag/status rules
 * directly. The status default mirrors the manual create form. Serial and
 * external identifiers remain separate from the physical tag; a new discovery
 * delegates tag allocation to shared numbering.
 */

import type { Knex } from 'knex';

/** F216: same default asset status as the manual create form. */
export function huduImportAssetStatus(): string {
  return 'active';
}

export interface DeriveHuduAssetTagInput {
  huduAssetId: string | number;
  primarySerial?: string | null;
}

/**
 * Hudu exposes a serial number and external id, not a supplied physical tag.
 * New Hudu discoveries therefore use the shared sequence; existing mapped
 * assets are updated without changing their printed tags.
 */
export async function deriveHuduAssetTag(
  _knex: Knex,
  _tenant: string,
  _input: DeriveHuduAssetTagInput
): Promise<string> {
  return '';
}
