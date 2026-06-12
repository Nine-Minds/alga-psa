/**
 * Hudu asset-layout → Alga asset-type map (EE-only, Phase 2 FR11/FR12).
 *
 * The map lives in `hudu_integrations.settings.asset_layout_type_map` as
 * `{ "<layout_id>": "<alga asset_type>" }` — no new table. This module owns
 * the jsonb contract (parse/normalize), the knex-level get/set (merging into
 * settings like the companies cache does, never clobbering sibling keys), the
 * layout-name heuristic, and the resolver the import group consumes.
 */

import type { Knex } from 'knex';
import { getHuduIntegration, upsertHuduIntegration } from './huduIntegrationRepository';

export const HUDU_ASSET_LAYOUT_TYPE_MAP_KEY = 'asset_layout_type_map' as const;

export const ALGA_ASSET_TYPES = [
  'workstation',
  'network_device',
  'server',
  'mobile_device',
  'printer',
  'unknown',
] as const;

export type AlgaAssetType = (typeof ALGA_ASSET_TYPES)[number];

/** F256: "Don't import" sentinel stored alongside the six asset types (FR6). */
export const HUDU_LAYOUT_EXCLUDED = 'excluded' as const;

export type HuduLayoutAssignment = AlgaAssetType | typeof HUDU_LAYOUT_EXCLUDED;

export type HuduAssetLayoutTypeMap = Record<string, HuduLayoutAssignment>;

export function isAlgaAssetType(value: unknown): value is AlgaAssetType {
  return typeof value === 'string' && (ALGA_ASSET_TYPES as readonly string[]).includes(value);
}

export function isHuduLayoutAssignment(value: unknown): value is HuduLayoutAssignment {
  return isAlgaAssetType(value) || value === HUDU_LAYOUT_EXCLUDED;
}

/** Coerce an arbitrary value into a valid map: non-object → {}, unknown types → 'unknown'. */
export function normalizeAssetLayoutTypeMap(value: unknown): HuduAssetLayoutTypeMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const map: HuduAssetLayoutTypeMap = {};
  for (const [layoutId, assetType] of Object.entries(value as Record<string, unknown>)) {
    map[String(layoutId)] = isHuduLayoutAssignment(assetType) ? assetType : 'unknown';
  }
  return map;
}

/** Read + shape-check the map out of a hudu_integrations.settings blob. */
export function parseAssetLayoutTypeMap(
  settings: Record<string, unknown> | null | undefined
): HuduAssetLayoutTypeMap {
  return normalizeAssetLayoutTypeMap(settings?.[HUDU_ASSET_LAYOUT_TYPE_MAP_KEY]);
}

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

// Precedence (first hit wins): server > network > printer > mobile > workstation,
// so "Computer Server Assets" classifies as 'server', not 'workstation'.
const LAYOUT_KEYWORD_RULES: Array<{ type: AlgaAssetType; keywords: string[] }> = [
  { type: 'server', keywords: ['server'] },
  {
    type: 'network_device',
    keywords: ['network', 'switch', 'router', 'firewall', 'access point', 'wifi', 'wireless'],
  },
  { type: 'printer', keywords: ['printer'] },
  { type: 'mobile_device', keywords: ['phone', 'mobile', 'tablet'] },
  { type: 'workstation', keywords: ['workstation', 'desktop', 'laptop', 'computer'] },
];

/** F206: case-insensitive keyword heuristic for a Hudu layout name. */
export function suggestAssetTypeForLayout(layoutName: string): AlgaAssetType {
  const name = (layoutName ?? '').toLowerCase();
  for (const rule of LAYOUT_KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => name.includes(keyword))) return rule.type;
  }
  return 'unknown';
}

/** F256: whether a layout is marked "Don't import" (FR6) — check BEFORE resolving a type. */
export function isLayoutExcluded(
  map: HuduAssetLayoutTypeMap | null | undefined,
  layoutId: string | number
): boolean {
  return map?.[String(layoutId)] === HUDU_LAYOUT_EXCLUDED;
}

/**
 * F208: configured type for a layout, falling back to 'unknown' (FR12).
 * Always a valid AlgaAssetType — an 'excluded' entry resolves to 'unknown',
 * so importing callers must check isLayoutExcluded first (F256).
 */
export function resolveAssetTypeForLayout(
  map: HuduAssetLayoutTypeMap | null | undefined,
  layoutId: string | number
): AlgaAssetType {
  const configured = map?.[String(layoutId)];
  return isAlgaAssetType(configured) ? configured : 'unknown';
}
