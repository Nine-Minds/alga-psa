import type { ChatApiExample, ChatApiParameter, ChatApiRegistryEntry } from './schema';
import {
  isPlaceholderDescription,
  searchRegistryEntries,
  type RegistrySearchResult,
} from './search';

export const REGISTRY_SEARCH_DEFAULT_LIMIT = 5;
export const REGISTRY_SEARCH_MAX_LIMIT = 25;
/** Top scores below this get a low-confidence note on the response envelope. */
export const LOW_CONFIDENCE_SCORE = 3;

const LOW_CONFIDENCE_NOTE =
  'Low match confidence — scores are weak; refine the query or verify the chosen endpoint.';

export interface RegistrySearchHit {
  entryId: string;
  displayName: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  parameters: ChatApiParameter[];
  requestBodySchema?: unknown;
  approvalRequired: boolean;
  score: number;
  examples?: ChatApiExample[];
}

export interface RegistrySearchResponse {
  query: string;
  count: number;
  results: RegistrySearchHit[];
  note?: string;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.floor(n), max));
}

/** Canonical projection of a ranked registry hit. Absent fields stay `undefined`. */
export function toRegistrySearchHit(r: RegistrySearchResult): RegistrySearchHit {
  const { entry } = r;
  return {
    entryId: entry.id,
    displayName: entry.displayName,
    method: entry.method.toUpperCase(),
    path: entry.path,
    summary: entry.summary,
    description: isPlaceholderDescription(entry.description) ? undefined : entry.description,
    parameters: entry.parameters,
    requestBodySchema: entry.requestBodySchema ?? undefined,
    approvalRequired: entry.approvalRequired,
    score: Number(r.score.toFixed(2)),
    examples: entry.examples && entry.examples.length > 0 ? entry.examples.slice(0, 1) : undefined,
  };
}

/** Shared `search_api_registry` runner: validation, limit clamp, ranked search, projection, envelope. */
export function runRegistrySearch(
  registry: ChatApiRegistryEntry[],
  args: { query?: unknown; limit?: unknown },
):
  | { ok: true; data: RegistrySearchResponse; error?: undefined }
  | { ok: false; error: string; data?: undefined } {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query.trim()) {
    return { ok: false, error: 'search_api_registry requires a non-empty "query".' };
  }
  const limit = clampInt(args.limit, REGISTRY_SEARCH_DEFAULT_LIMIT, 1, REGISTRY_SEARCH_MAX_LIMIT);
  const results = searchRegistryEntries(registry, query, limit).map(toRegistrySearchHit);
  return {
    ok: true,
    data: {
      query,
      count: results.length,
      results,
      note:
        results.length > 0 && results[0].score < LOW_CONFIDENCE_SCORE
          ? LOW_CONFIDENCE_NOTE
          : undefined,
    },
  };
}
