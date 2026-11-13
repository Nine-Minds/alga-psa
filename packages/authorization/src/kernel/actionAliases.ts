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

/**
 * Actions that are only permitted on a record the subject may also perform
 * another action on. Changing or removing a record presupposes being able to
 * see it, so `update` and `delete` each require `read`. The kernel evaluates
 * the subject's record rules for every prerequisite before the action itself.
 */
const ACTION_PREREQUISITES: Record<string, readonly string[]> = {
  update: ['read'],
  delete: ['read'],
};

export function prerequisiteActionsFor(action: string): readonly string[] {
  return ACTION_PREREQUISITES[action] ?? [];
}
