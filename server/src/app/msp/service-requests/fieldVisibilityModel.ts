import type { PredicateOperator } from '@alga-psa/predicates';
import { getFieldElementKind, getFieldType } from '@alga-psa/ui/form-fields';
import type { VisibilityRule, VisibilityRuleOperator } from '../../../lib/service-requests/formVisibility';

export const VISIBILITY_OPERATORS: VisibilityRuleOperator[] = [
  'equals',
  'not-equals',
  'is-true',
  'is-false',
  'has-value',
  'is-empty',
];

/**
 * Visibility rules keep their own six-operator dialect in storage, and the evaluator in
 * `formVisibility.ts` keeps reading it verbatim — moving published definitions to predicate
 * clauses would rewrite every stored rule for no behaviour change. New rule kinds (phase 3's
 * required-when, option filters) use `PredicateClause` directly; this adapter is how the
 * builder's predicate-shaped editor reads and writes today's dialect.
 */
export const VISIBILITY_OPERATOR_AS_PREDICATE: Readonly<
  Record<VisibilityRuleOperator, PredicateOperator>
> = {
  equals: 'equals',
  'not-equals': 'not_equals',
  // "is true"/"is false" are equality against a boolean once the value is typed.
  'is-true': 'equals',
  'is-false': 'not_equals',
  'has-value': 'is_not_empty',
  'is-empty': 'is_empty',
};

/**
 * The operators a source field's type can be compared with, in the visibility dialect.
 *
 * `is-true` / `is-false` are asking whether a box is ticked, so they belong to a checkbox and
 * nowhere else — the predicate adapter alone cannot tell, because it maps them onto `equals` /
 * `not_equals`, which every type supports. An unknown type keeps the whole dialect: a rule
 * stored against a type this build does not know must still round-trip.
 */
const CHECKBOX_ONLY_OPERATORS: ReadonlySet<VisibilityRuleOperator> = new Set(['is-true', 'is-false']);

export function getVisibilityOperatorsForType(type: unknown): VisibilityRuleOperator[] {
  const definition = getFieldType(type);
  if (!definition) return VISIBILITY_OPERATORS;
  if (definition.key === 'checkbox') {
    // A box always holds an answer, so "has a value" and "is empty" say nothing about it.
    return ['is-true', 'is-false', 'equals', 'not-equals'];
  }
  const supported = new Set<PredicateOperator>(definition.operators);
  return VISIBILITY_OPERATORS.filter(
    (operator) =>
      !CHECKBOX_ONLY_OPERATORS.has(operator) &&
      supported.has(VISIBILITY_OPERATOR_AS_PREDICATE[operator])
  );
}

export interface VisibilityCandidateField {
  key?: unknown;
  type?: unknown;
}

/**
 * The elements that can be read by a rule: answer-carrying inputs only. A display block can be
 * shown or hidden, but it holds no value, so it is never a rule source.
 */
export function getVisibilitySourceFields<T extends VisibilityCandidateField>(
  fields: readonly T[]
): T[] {
  return fields.filter(
    (field) => typeof field?.key === 'string' && getFieldElementKind(field.type) === 'input'
  );
}

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
