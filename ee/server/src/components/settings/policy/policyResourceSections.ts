/**
 * The policy screen's resource sections, derived from the kernel's resource catalog (served by
 * `listAuthorizationResourceTypesAction`). The screen keeps no list of its own: a type the kernel registers gets
 * a section. Labels are localized under `policyManagement.resourceTypes.<type>`; a type with no translation yet
 * falls back to a readable form of its identifier rather than disappearing.
 */
export interface ResourceSection {
  resourceType: string;
  labelKey: string;
  fallbackLabel: string;
}

export function humanizeResourceType(resourceType: string): string {
  const words = resourceType.split('_').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function buildResourceSections(resourceTypes: readonly string[]): ResourceSection[] {
  return resourceTypes.map((resourceType) => ({
    resourceType,
    labelKey: `policyManagement.resourceTypes.${resourceType}`,
    fallbackLabel: humanizeResourceType(resourceType),
  }));
}
