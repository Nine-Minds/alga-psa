import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { assetTagClaimsRequired, claimAssetTag, normalizeAssetTag } from '../services/assetNumbering';

type AssetFixture = Record<string, unknown> & { tenant: string; asset_tag: string; asset_id?: string };
type PersistedAssetFixture<T> = T & { asset_id: string; asset_tag_normalized: string; asset_tag_managed: boolean };

/** Insert ordinary fixture assets with real identity claims, retaining caller-supplied IDs. */
export async function insertTestAssets<T extends AssetFixture>(
  db: Knex,
  input: T | readonly T[],
): Promise<PersistedAssetFixture<T>[]> {
  const insert = async (trx: Knex.Transaction): Promise<PersistedAssetFixture<T>[]> => {
    const rows: PersistedAssetFixture<T>[] = [];
    const fixtures: readonly T[] = Array.isArray(input) ? input : [input as T];
    for (const fixture of fixtures) {
      const asset_id = fixture.asset_id ?? randomUUID();
      const managed = await assetTagClaimsRequired(trx, fixture.tenant);
      await claimAssetTag(trx, {
        tenant: fixture.tenant, assetTag: fixture.asset_tag, ownerKind: 'asset', ownerId: asset_id,
      });
      rows.push({ ...fixture, asset_id, asset_tag_normalized: normalizeAssetTag(fixture.asset_tag), asset_tag_managed: managed });
    }
    const inserted = await trx('assets').insert(rows).returning('*');
    return inserted as PersistedAssetFixture<T>[];
  };
  return db.isTransaction ? insert(db as Knex.Transaction) : db.transaction(insert);
}
