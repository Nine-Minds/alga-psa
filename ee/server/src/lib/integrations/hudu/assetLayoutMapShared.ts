/**
 * Client-safe half of the Hudu asset-layout → Alga asset-type map: the jsonb
 * contract (constants, types, parse/normalize), the layout-name heuristic, and
 * the resolver. Deliberately free of any knex / `./huduIntegrationRepository`
 * (and therefore `@alga-psa/db`) import so client components can use these pure
 * helpers without pulling the server-only db chain into the browser bundle.
 *
 * The knex-level get/set live in `./assetLayoutMap`, which re-exports everything
 * here so server importers keep a single import surface.
 */

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

/**
 * F315: assignments are any registry slug (built-in or custom) or 'excluded'.
 * Storage keeps every slug-shaped string; registry membership is enforced at
 * import time by resolveAssetTypeForLayout (a stale custom slug → 'unknown').
 */
export type HuduLayoutAssignment = AlgaAssetType | typeof HUDU_LAYOUT_EXCLUDED | (string & {});

export type HuduAssetLayoutTypeMap = Record<string, HuduLayoutAssignment>;

/** Same shape generateAssetTypeSlug produces (assetTypeRegistry). */
const ASSET_TYPE_SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;

export function isAlgaAssetType(value: unknown): value is AlgaAssetType {
  return typeof value === 'string' && (ALGA_ASSET_TYPES as readonly string[]).includes(value);
}

export function isHuduLayoutAssignment(value: unknown): value is HuduLayoutAssignment {
  return (
    value === HUDU_LAYOUT_EXCLUDED ||
    (typeof value === 'string' && ASSET_TYPE_SLUG_PATTERN.test(value))
  );
}

/** Coerce an arbitrary value into a valid map: non-object → {}, non-slug junk → 'unknown'. */
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
 * F208/F315: configured type for a layout, falling back to 'unknown' (FR12).
 * Built-ins always resolve; a custom slug resolves only when it is in the
 * caller-supplied registry slug set (the import action passes the tenant's
 * live registry — this module stays knex-free). An 'excluded' entry resolves
 * to 'unknown', so importing callers must check isLayoutExcluded first (F256).
 */
export function resolveAssetTypeForLayout(
  map: HuduAssetLayoutTypeMap | null | undefined,
  layoutId: string | number,
  registrySlugs?: ReadonlySet<string>
): string {
  const configured = map?.[String(layoutId)];
  if (isAlgaAssetType(configured)) return configured;
  if (
    typeof configured === 'string' &&
    configured !== HUDU_LAYOUT_EXCLUDED &&
    ASSET_TYPE_SLUG_PATTERN.test(configured) &&
    registrySlugs?.has(configured)
  ) {
    return configured;
  }
  return 'unknown';
}
