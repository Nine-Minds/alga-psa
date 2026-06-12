import {
  searchRegistryEntries,
  type ChatApiRegistryEntry,
  type CallEndpointArgs,
} from '@alga-psa/agent-tooling';
import type { InstanceClient } from './instanceClient.js';

export interface ToolOutcome {
  data: unknown;
  isError: boolean;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.floor(n), max));
}

/** Resolve a registry entry by its id, tolerating `-`/`_` id variants. */
export function resolveEntry(
  registry: ChatApiRegistryEntry[],
  entryId: unknown,
): ChatApiRegistryEntry | null {
  const want = String(entryId ?? '').replace(/-/g, '_');
  if (!want) return null;
  return registry.find((e) => e.id.replace(/-/g, '_') === want) ?? null;
}

export async function handleSearchApiRegistry(
  registry: ChatApiRegistryEntry[],
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query.trim()) {
    return { data: { error: 'search_api_registry requires a non-empty "query".' }, isError: true };
  }
  const limit = clampInt(args.limit, 5, 1, 25);
  const results = searchRegistryEntries(registry, query, limit).map((r) => ({
    entryId: r.entry.id,
    displayName: r.entry.displayName,
    method: r.entry.method.toUpperCase(),
    path: r.entry.path,
    summary: r.entry.summary,
    description: r.entry.description,
    parameters: r.entry.parameters,
    requestBodySchema: r.entry.requestBodySchema,
    approvalRequired: r.entry.approvalRequired,
    score: Number(r.score.toFixed(2)),
    examples: r.entry.examples?.slice(0, 1),
  }));
  return {
    data: {
      query,
      count: results.length,
      results,
      note:
        results.length > 0 && results[0].score < 3
          ? 'Low match confidence — scores are weak; refine the query or verify the chosen endpoint.'
          : undefined,
    },
    isError: false,
  };
}

export async function handleSearchBusinessData(
  client: InstanceClient,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query.trim()) {
    return { data: { error: 'search_business_data requires a non-empty "query".' }, isError: true };
  }
  const res = await client.searchBusinessData(args);
  return { data: res.data, isError: !res.ok };
}

export async function handleCallApiEndpoint(
  registry: ChatApiRegistryEntry[],
  client: InstanceClient,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const entryId = args.entryId;
  if (!entryId || typeof entryId !== 'string') {
    return {
      data: { error: 'call_api_endpoint requires "entryId" (use search_api_registry first).' },
      isError: true,
    };
  }
  const entry = resolveEntry(registry, entryId);
  if (!entry) {
    return { data: { error: `No registry entry found for entryId "${entryId}".` }, isError: true };
  }
  const res = await client.callEndpoint(entry, args as CallEndpointArgs);
  return { data: { status: res.status, ok: res.ok, data: res.data }, isError: !res.ok };
}
