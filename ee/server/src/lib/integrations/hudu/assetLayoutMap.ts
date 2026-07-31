/**
 * Hudu asset-layout → Alga asset-type map (EE-only, Phase 2 FR11/FR12).
 *
 * The map lives in `hudu_integrations.settings.asset_layout_type_map` as
 * `{ "<layout_id>": "<alga asset_type>" }` — no new table. This module owns
 * the jsonb contract (parse/normalize), the knex-level get/set (merging into
 * settings like the companies cache does, never clobbering sibling keys), the
 * layout-name heuristic, and the resolver the import group consumes.
 *
 * The jsonb contract, heuristic, and resolver are pure and live in
 * `./assetLayoutMapShared` (client-safe); they are re-exported here so server
 * importers keep a single import surface. Only the knex-level get/set — which
 * need `./huduIntegrationRepository` (and therefore @alga-psa/db) — live here.
 */

import type { Knex } from 'knex';
import { getHuduIntegration, upsertHuduIntegration } from './huduIntegrationRepository';
import {
  HUDU_ASSET_LAYOUT_TYPE_MAP_KEY,
  normalizeAssetLayoutTypeMap,
  parseAssetLayoutTypeMap,
  type HuduAssetLayoutTypeMap,
} from './assetLayoutMapShared';

export * from './assetLayoutMapShared';

export async function getHuduAssetLayoutTypeMap(
  knex: Knex,
  tenant: string
): Promise<HuduAssetLayoutTypeMap> {
  const row = await getHuduIntegration(knex, tenant);
  return parseAssetLayoutTypeMap(row?.settings);
}

/** Persist the map under settings.asset_layout_type_map, preserving sibling settings keys. */
export async function setHuduAssetLayoutTypeMap(
  knex: Knex,
  tenant: string,
  map: HuduAssetLayoutTypeMap
): Promise<HuduAssetLayoutTypeMap> {
  const normalized = normalizeAssetLayoutTypeMap(map);
  const row = await getHuduIntegration(knex, tenant);
  await upsertHuduIntegration(knex, tenant, {
    settings: { ...(row?.settings ?? {}), [HUDU_ASSET_LAYOUT_TYPE_MAP_KEY]: normalized },
  });
  return normalized;
}
