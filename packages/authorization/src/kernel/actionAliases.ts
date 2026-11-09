/**
 * Mutation actions may inherit a more general policy when no exact action rule
 * exists. Exact rules always take precedence over these aliases.
 */
const ACTION_ALIASES: Record<string, readonly string[]> = {
  delete: ['update'],
};

export function matchRulesForAction<T extends { resource: string; action: string }>(
  rules: T[],
  resource: string,
  action: string,
): T[] {
  const exact = rules.filter((rule) => rule.resource === resource && rule.action === action);
  if (exact.length > 0) return exact;

  const aliases = ACTION_ALIASES[action] ?? [];
  return rules.filter((rule) => rule.resource === resource && aliases.includes(rule.action));
}
