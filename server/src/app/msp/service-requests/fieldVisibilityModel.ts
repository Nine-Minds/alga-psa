import type { VisibilityRule, VisibilityRuleOperator } from '../../../lib/service-requests/formVisibility';

export const VISIBILITY_OPERATORS: VisibilityRuleOperator[] = [
  'equals',
  'not-equals',
  'is-true',
  'is-false',
  'has-value',
  'is-empty',
];

export const VISIBILITY_CONTEXT_SOURCES = [
  'context.requesterUserId',
  'context.clientId',
  'context.contactId',
] as const;

export function operatorNeedsValue(operator: VisibilityRuleOperator): boolean {
  return operator === 'equals' || operator === 'not-equals';
}

function isRuleFor(candidate: unknown, fieldKey: string): boolean {
  return (
    !!candidate &&
    typeof candidate === 'object' &&
    !Array.isArray(candidate) &&
    typeof (candidate as Record<string, unknown>).fieldKey === 'string' &&
    ((candidate as Record<string, unknown>).fieldKey as string).trim() === fieldKey
  );
}

/** The valid rules in `config.visibilityRules` that target `fieldKey`. */
export function getFieldVisibilityRules(
  config: Record<string, unknown>,
  fieldKey: string
): VisibilityRule[] {
  if (!Array.isArray(config.visibilityRules)) {
    return [];
  }
  return config.visibilityRules
    .filter((candidate) => isRuleFor(candidate, fieldKey))
    .flatMap((candidate) => {
      const rule = candidate as Record<string, unknown>;
      if (typeof rule.source !== 'string' || !VISIBILITY_OPERATORS.includes(rule.operator as VisibilityRuleOperator)) {
        return [];
      }
      return [
        {
          fieldKey,
          source: rule.source.trim(),
          operator: rule.operator as VisibilityRuleOperator,
          ...(rule.value !== undefined ? { value: rule.value } : {}),
        },
      ];
    });
}

/**
 * Returns a copy of `config` where only `fieldKey`'s rules are replaced. Everything else
 * (contextDefaults, unknown keys, other fields' rules and their order) is preserved.
 */
export function replaceFieldVisibilityRules(
  config: Record<string, unknown>,
  fieldKey: string,
  rules: VisibilityRule[]
): Record<string, unknown> {
  const existing = Array.isArray(config.visibilityRules) ? config.visibilityRules : [];
  const others = existing.filter((candidate) => !isRuleFor(candidate, fieldKey));
  const next = [...others, ...rules.map((rule) => ({ ...rule, fieldKey }))];
  const { visibilityRules: _previous, ...rest } = config;
  return next.length > 0 ? { ...rest, visibilityRules: next } : rest;
}
