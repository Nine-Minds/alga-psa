import { chatApiRegistry } from './apiRegistry.generated';
import { ChatApiRegistryEntry } from './apiRegistry.schema';
import {
  RegistrySearchResult,
  searchRegistryEntries,
} from './search';

export function searchRegistry(query: string, limit = 5): RegistrySearchResult[] {
  return searchRegistryEntries(chatApiRegistry, query, limit);
}

export function getRegistry(): ChatApiRegistryEntry[] {
  return chatApiRegistry;
}
