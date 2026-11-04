import {
  runRegistrySearch,
  buildAttachFileRequest,
  AttachFileInputError,
  type ChatApiRegistryEntry,
  type CallEndpointArgs,
} from '@alga-psa/agent-tooling';
import type { InstanceClient } from './instanceClient.js';

export interface ToolOutcome {
  data: unknown;
  isError: boolean;
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
  const r = runRegistrySearch(registry, args);
  return r.ok ? { data: r.data, isError: false } : { data: { error: r.error }, isError: true };
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

// LEVERAGE: pattern mcp-tool-dispatch — the same attach_file dispatch lives in ee/server jsonRpcServer.ts
export async function handleAttachFile(
  client: InstanceClient,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  let built;
  try {
    built = buildAttachFileRequest(args);
  } catch (error) {
    // AttachFileInputError messages never echo the signed download URL.
    if (error instanceof AttachFileInputError) return { data: { error: error.message }, isError: true };
    throw error;
  }
  const res = await client.sendBuilt(built);
  return { data: { status: res.status, ok: res.ok, data: res.data }, isError: !res.ok };
}
