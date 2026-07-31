/**
 * Hudu asset↔Alga asset auto-suggest matcher (F209/F210, pure — no DB/IO).
 *
 * Mirrors suggestHuduCompanyMappings: serial exact (1.0) → exact
 * case-insensitive name (0.9) → fuzzy name ≥ HUDU_FUZZY_MATCH_THRESHOLD,
 * greedy one-to-one. Blank serials never serial-match (F210).
 */

import {
  HUDU_EXACT_NAME_CONFIDENCE,
  HUDU_FUZZY_MATCH_THRESHOLD,
  huduNameSimilarity,
} from './companyMapping';

export const HUDU_SERIAL_CONFIDENCE = 1.0;

export type HuduAssetSuggestionSource = 'serial' | 'exact_name' | 'fuzzy_name';

export interface HuduAssetMappingSuggestion {
  asset_id: string;
  asset_name: string;
  source: HuduAssetSuggestionSource;
  confidence: number;
}

/** Matcher input: a HuduAsset or a cache entry. */
export interface HuduMatcherAsset {
  id: number;
  name: string;
  primary_serial?: string | null;
}

export interface AlgaMatcherAsset {
  asset_id: string;
  asset_name: string;
  serial_number?: string | null;
}

/** Minimal existing-mapping reference for exclusion. */
export interface HuduAssetExistingMappingRef {
  asset_id: string;
  hudu_asset_id: string | number;
}

function normalizeSerial(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Suggest an Alga asset for each unmapped Hudu asset. Priority per asset:
 * (1) serial exact (case-insensitive, trimmed; blanks never match) → 'serial', 1.0;
 * (2) exact case-insensitive name → 'exact_name', 0.9;
 * (3) fuzzy name ≥ HUDU_FUZZY_MATCH_THRESHOLD → 'fuzzy_name', score.
 * Already-mapped Hudu assets get no suggestion; already-mapped Alga assets are
 * excluded as targets; each Alga asset is claimed by at most one suggestion
 * (higher-priority/higher-score pass wins).
 */
export function suggestHuduAssetMappings(
  huduAssets: HuduMatcherAsset[],
  algaAssets: AlgaMatcherAsset[],
  existingMappings: HuduAssetExistingMappingRef[] = []
): Map<number, HuduAssetMappingSuggestion> {
  const suggestions = new Map<number, HuduAssetMappingSuggestion>();

  const mappedHuduAssetIds = new Set(existingMappings.map((m) => String(m.hudu_asset_id)));
  const claimedAssetIds = new Set(existingMappings.map((m) => m.asset_id));

  const candidates = huduAssets.filter((a) => !mappedHuduAssetIds.has(String(a.id)));
  const available = () => algaAssets.filter((a) => !claimedAssetIds.has(a.asset_id));

  const claim = (huduAssetId: number, asset: AlgaMatcherAsset, source: HuduAssetSuggestionSource, confidence: number) => {
    suggestions.set(huduAssetId, {
      asset_id: asset.asset_id,
      asset_name: asset.asset_name,
      source,
      confidence: Number(confidence.toFixed(4)),
    });
    claimedAssetIds.add(asset.asset_id);
  };

  // Pass 1: serial exact — blank serials are skipped on both sides (F210).
  for (const huduAsset of candidates) {
    if (suggestions.has(huduAsset.id)) continue;
    const serial = normalizeSerial(huduAsset.primary_serial);
    if (!serial) continue;
    const match = available().find((a) => normalizeSerial(a.serial_number) === serial);
    if (match) claim(huduAsset.id, match, 'serial', HUDU_SERIAL_CONFIDENCE);
  }

  // Pass 2: exact case-insensitive name.
  for (const huduAsset of candidates) {
    if (suggestions.has(huduAsset.id)) continue;
    const name = huduAsset.name.trim().toLowerCase();
    if (!name) continue;
    const match = available().find((a) => a.asset_name.trim().toLowerCase() === name);
    if (match) claim(huduAsset.id, match, 'exact_name', HUDU_EXACT_NAME_CONFIDENCE);
  }

  // Pass 3: fuzzy name ≥ threshold, best pairs first (greedy one-to-one).
  const fuzzyPairs: Array<{ huduAsset: HuduMatcherAsset; asset: AlgaMatcherAsset; score: number }> = [];
  for (const huduAsset of candidates) {
    if (suggestions.has(huduAsset.id)) continue;
    for (const asset of available()) {
      const score = huduNameSimilarity(huduAsset.name, asset.asset_name);
      if (score >= HUDU_FUZZY_MATCH_THRESHOLD) {
        fuzzyPairs.push({ huduAsset, asset, score });
      }
    }
  }
  fuzzyPairs.sort((a, b) => b.score - a.score);
  for (const pair of fuzzyPairs) {
    if (suggestions.has(pair.huduAsset.id) || claimedAssetIds.has(pair.asset.asset_id)) continue;
    claim(pair.huduAsset.id, pair.asset, 'fuzzy_name', pair.score);
  }

  return suggestions;
}
