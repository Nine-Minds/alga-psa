import type { ChatApiRegistryEntry } from '@alga-psa/agent-tooling/registry/schema';
import { isEnterpriseEdition } from '@/lib/features';

export interface LoadedRegistry {
  edition: 'ce' | 'ee';
  entries: ChatApiRegistryEntry[];
}

let cache: LoadedRegistry | null = null;

/**
 * Load the edition-appropriate MCP endpoint registry. CE builds serve the CE
 * registry; EE builds serve the EE registry via the product-chat seam, falling
 * back to CE if the EE artifact is unavailable. Result is memoized.
 */
export async function loadMcpRegistry(): Promise<LoadedRegistry> {
  if (cache) return cache;

  const { chatApiRegistry } = await import('@/lib/mcp/registry.generated');
  let edition: 'ce' | 'ee' = 'ce';
  let entries = chatApiRegistry as ChatApiRegistryEntry[];

  if (isEnterpriseEdition()) {
    try {
      const mod = (await import('@product/chat/entry')) as { eeMcpRegistry?: ChatApiRegistryEntry[] };
      if (Array.isArray(mod.eeMcpRegistry)) {
        entries = mod.eeMcpRegistry;
        edition = 'ee';
      }
    } catch {
      // EE registry artifact unavailable — fall back to the CE registry.
    }
  }

  cache = { edition, entries };
  return cache;
}
