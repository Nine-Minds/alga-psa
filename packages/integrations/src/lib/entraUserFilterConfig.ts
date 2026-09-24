export interface EntraUserFilterConfig {
  version: 1;
  memberUsersOnly: boolean;
  licensedUsersOnly: boolean;
  includeGroupIds: string[];
  excludeGroupIds: string[];
  exclusionPatterns: string[];
  deactivateExcludedContacts: boolean;
}

export function mergeEntraUserFilterConfig(
  defaults: EntraUserFilterConfig,
  override?: Partial<EntraUserFilterConfig> | null,
): EntraUserFilterConfig {
  if (!override) {
    return {
      ...defaults,
      includeGroupIds: [...defaults.includeGroupIds],
      excludeGroupIds: [...defaults.excludeGroupIds],
      exclusionPatterns: [...defaults.exclusionPatterns],
    };
  }

  return {
    version: 1,
    memberUsersOnly: override.memberUsersOnly ?? defaults.memberUsersOnly,
    licensedUsersOnly: override.licensedUsersOnly ?? defaults.licensedUsersOnly,
    includeGroupIds: override.includeGroupIds ?? defaults.includeGroupIds,
    excludeGroupIds: [...new Set([...defaults.excludeGroupIds, ...(override.excludeGroupIds ?? [])])],
    exclusionPatterns: [...new Set([...defaults.exclusionPatterns, ...(override.exclusionPatterns ?? [])])],
    deactivateExcludedContacts: override.deactivateExcludedContacts ?? defaults.deactivateExcludedContacts,
  };
}
