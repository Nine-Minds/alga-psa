import type {
  DiagnosticsRecommendation,
  DiagnosticsSeverity,
} from '@alga-psa/types';

const SEVERITY_RANK: Record<DiagnosticsSeverity, number> = {
  fail: 0,
  warn: 1,
  info: 2,
};

/**
 * Stable dedupe key. The action payload is part of the key so two customer
 * consent URLs for two different tenants are both retained.
 */
function recommendationKey(rec: DiagnosticsRecommendation): string {
  const action = rec.action ? `${rec.action.kind}:${rec.action.payload}` : '';
  // Include interpolation parameters (the affected context) so two different
  // missing mapped tenants or scopes remain visible instead of collapsing.
  const params = rec.params
    ? Object.keys(rec.params)
        .sort()
        .map((key) => `${key}=${String(rec.params![key])}`)
        .join(',')
    : '';
  return `${rec.code}|${params}|${action}`;
}

/**
 * Deduplicate recommendations by code + action payload, retaining distinct
 * customer consent URLs, then order fail > warn > info. Stable within equal
 * severity.
 */
export function dedupeRecommendations(
  recommendations: DiagnosticsRecommendation[]
): DiagnosticsRecommendation[] {
  const seen = new Map<string, DiagnosticsRecommendation>();
  for (const rec of recommendations) {
    if (!rec) continue;
    const key = recommendationKey(rec);
    if (!seen.has(key)) {
      seen.set(key, rec);
    }
  }
  return Array.from(seen.values())
    .map((rec, index) => ({ rec, index }))
    .sort((a, b) => {
      const rank = SEVERITY_RANK[a.rec.severity] - SEVERITY_RANK[b.rec.severity];
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((entry) => entry.rec);
}

/** Aggregate client outcome categories, counting each client once. */
export function aggregateClientCategories(
  categories: Array<'ok' | 'need_consent' | 'conditional_access' | 'missing_role' | 'other'>
): Record<'ok' | 'need_consent' | 'conditional_access' | 'missing_role' | 'other', number> {
  const counts = {
    ok: 0,
    need_consent: 0,
    conditional_access: 0,
    missing_role: 0,
    other: 0,
  };
  for (const category of categories) {
    counts[category] += 1;
  }
  return counts;
}
