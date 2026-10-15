import type { MappingRule, MappingRulesSnapshot } from './types';

/**
 * Normalizes the JSONB working copy / version snapshot shape (`{ rules: [] }`).
 * Tolerates legacy or malformed values by falling back to an empty rule set.
 */
export function normalizeRulesSnapshot(raw: unknown): MappingRulesSnapshot {
  if (raw && typeof raw === 'object' && Array.isArray((raw as { rules?: unknown }).rules)) {
    return { rules: (raw as { rules: MappingRule[] }).rules };
  }
  return { rules: [] };
}
