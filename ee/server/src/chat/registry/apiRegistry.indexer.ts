import { chatApiRegistry } from './apiRegistry.generated';
import { ChatApiRegistryEntry } from './apiRegistry.schema';

export interface RegistrySearchResult {
  entry: ChatApiRegistryEntry;
  score: number;
  matchedFields: string[];
}

function computeScore(entry: ChatApiRegistryEntry, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return { score: 0, fields: [] as string[] };
  }

  const fields: Array<{ key: string; value?: string }> = [
    { key: 'displayName', value: entry.displayName },
    { key: 'summary', value: entry.summary },
    { key: 'description', value: entry.description },
    { key: 'tags', value: entry.tags.join(' ') },
    { key: 'path', value: entry.path },
  ];

  let score = 0;
  const matchedFields: string[] = [];

  for (const field of fields) {
    if (!field.value) continue;
    const value = field.value.toLowerCase();
    if (value.includes(normalized)) {
      matchedFields.push(field.key);
      score += normalized.length / value.length;
    }
  }

  return { score, fields: matchedFields };
}

export function searchRegistry(query: string, limit = 5): RegistrySearchResult[] {
  const results = chatApiRegistry
    .map((entry) => {
      const { score, fields } = computeScore(entry, query);
      return { entry, score, matchedFields: fields };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;
}

export function getRegistry(): ChatApiRegistryEntry[] {
  return chatApiRegistry;
}
