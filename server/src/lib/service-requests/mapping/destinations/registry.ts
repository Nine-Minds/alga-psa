import { accountDestinationProvider } from './accountDestinationProvider';
import { assetDestinationProvider } from './assetDestinationProvider';
import type { MappingDestinationProvider, MappingTargetField } from '../types';

/**
 * Destination-provider registry. Mirrors the execution/form-behavior provider
 * registry shape: a global keyed singleton, built-in registration refreshed on
 * every access (so dev hot reloads pick up allowlist edits), and a separate
 * registration entry point for future providers.
 *
 * Adding a new structured destination (contacts, locations, a billing record)
 * is exactly: implement one more `MappingDestinationProvider` and register it.
 * The engine does not change.
 */
interface MappingDestinationRegistryStore {
  providers: Map<string, MappingDestinationProvider>;
}

const builtInProviders: MappingDestinationProvider[] = [
  accountDestinationProvider,
  assetDestinationProvider,
];

declare global {
  // eslint-disable-next-line no-var
  var __algaMappingDestinationRegistry: MappingDestinationRegistryStore | undefined;
}

// LEVERAGE: pattern provider-registry — this is the second typed keyed provider
// registry in the service-requests domain (providers/registry.ts is the first).
// Extract a generic `createProviderRegistry<T>()` when a third instance appears
// (plan OQ-7).
function createStoreWithBuiltIns(): MappingDestinationRegistryStore {
  const store: MappingDestinationRegistryStore = { providers: new Map() };
  for (const provider of builtInProviders) {
    store.providers.set(provider.kind, provider);
  }
  return store;
}

function getOrCreateStore(): MappingDestinationRegistryStore {
  if (!globalThis.__algaMappingDestinationRegistry) {
    globalThis.__algaMappingDestinationRegistry = { providers: new Map() };
    for (const provider of builtInProviders) {
      globalThis.__algaMappingDestinationRegistry.providers.set(provider.kind, provider);
    }
  } else {
    for (const provider of builtInProviders) {
      globalThis.__algaMappingDestinationRegistry.providers.set(provider.kind, provider);
    }
  }
  return globalThis.__algaMappingDestinationRegistry;
}

export function registerMappingDestinationProviders(
  providers: MappingDestinationProvider[]
): void {
  const store = getOrCreateStore();
  for (const provider of providers) {
    store.providers.set(provider.kind, provider);
  }
}

export function getMappingDestinationProvider(
  kind: string
): MappingDestinationProvider | undefined {
  return getOrCreateStore().providers.get(kind);
}

export function listMappingDestinationProviders(): MappingDestinationProvider[] {
  return [...getOrCreateStore().providers.values()];
}

export interface MappingTargetFieldCatalogEntry {
  kind: string;
  kindDisplayName: string;
  fields: Array<{
    fieldKey: string;
    displayLabel: string;
    dataType: string;
    enumValues?: string[];
  }>;
}

/** Serializable allowlist for the admin UI (no functions cross the boundary). */
export function listMappingTargetFieldCatalog(): MappingTargetFieldCatalogEntry[] {
  return listMappingDestinationProviders().map((provider) => ({
    kind: provider.kind,
    kindDisplayName: provider.displayName,
    fields: provider.listTargetFields().map((field) => ({
      fieldKey: field.fieldKey,
      displayLabel: field.displayLabel,
      dataType: field.dataType,
      enumValues: field.enumValues,
    })),
  }));
}

export function getMappingTargetField(
  kind: string,
  fieldKey: string
): MappingTargetField | undefined {
  return getMappingDestinationProvider(kind)?.getTargetField(fieldKey);
}

export function resetMappingDestinationRegistry(): void {
  globalThis.__algaMappingDestinationRegistry = createStoreWithBuiltIns();
}
