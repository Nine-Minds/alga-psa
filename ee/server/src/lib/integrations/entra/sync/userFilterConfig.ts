import { mergeEntraUserFilterConfig } from '@alga-psa/integrations/lib/entraUserFilterConfig';
import type { EntraUserFilterConfig } from '@alga-psa/integrations/lib/entraUserFilterConfig';

export { mergeEntraUserFilterConfig };
export type { EntraUserFilterConfig };

export const EMPTY_ENTRA_USER_FILTER_CONFIG: EntraUserFilterConfig = {
  version: 1,
  memberUsersOnly: false,
  licensedUsersOnly: false,
  includeGroupIds: [],
  excludeGroupIds: [],
  exclusionPatterns: [],
  deactivateExcludedContacts: false,
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
  : [];
const bool = (value: unknown): boolean => value === true;

export function parseEntraUserFilterConfig(value: unknown): EntraUserFilterConfig {
  const raw = asObject(value);
  return {
    version: 1,
    memberUsersOnly: bool(raw.memberUsersOnly),
    licensedUsersOnly: bool(raw.licensedUsersOnly),
    includeGroupIds: strings(raw.includeGroupIds),
    excludeGroupIds: strings(raw.excludeGroupIds),
    exclusionPatterns: [...new Set([...strings(raw.exclusionPatterns), ...strings(raw.excludePatterns), ...strings(raw.excludeUpnPatterns), ...strings(raw.excludedUpnPatterns)])],
    deactivateExcludedContacts: bool(raw.deactivateExcludedContacts),
  };
}

export function validateEntraUserFilterConfig(value: unknown): { config?: EntraUserFilterConfig; error?: string } {
  const raw = asObject(value);
  const parsed = parseEntraUserFilterConfig(raw);
  for (const pattern of parsed.exclusionPatterns) {
    try { new RegExp(pattern, 'i'); }
    catch { return { error: `Invalid exclusion pattern "${pattern}": check the regular expression syntax.` }; }
  }
  for (const key of ['includeGroupIds', 'excludeGroupIds', 'exclusionPatterns', 'excludePatterns', 'excludeUpnPatterns', 'excludedUpnPatterns']) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) return { error: `${key} must be a list.` };
  }
  return { config: parsed };
}

/** Preserve omitted fields for managed-tenant partial overrides. */
export function parseEntraUserFilterOverride(value: unknown): Partial<EntraUserFilterConfig> {
  const raw = asObject(value);
  const parsed = parseEntraUserFilterConfig(raw);
  const result: Partial<EntraUserFilterConfig> = { version: 1 };
  for (const key of ['memberUsersOnly', 'licensedUsersOnly', 'includeGroupIds', 'excludeGroupIds', 'exclusionPatterns', 'deactivateExcludedContacts'] as const) {
    if (raw[key] !== undefined || (key === 'exclusionPatterns' && ['excludePatterns', 'excludeUpnPatterns', 'excludedUpnPatterns'].some(alias => raw[alias] !== undefined))) result[key] = parsed[key] as never;
  }
  return result;
}
