/**
 * Predicate model shared by workflow conditions and the ticket list filters.
 * Semantics are defined in `spec/SEMANTICS.md` and enforced by `spec/conformance.json`.
 *
 * This file and everything re-exported from the package root must stay deterministic and free of
 * Node APIs: the workflow condition evaluator runs inside the Temporal sandbox.
 */
export const PREDICATE_OPERATORS = [
  'equals',
  'not_equals',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'starts_with',
  'ends_with',
  'not_contains',
  'not_starts_with',
  'not_ends_with',
  'is_empty',
  'is_not_empty',
] as const;

export type PredicateOperator = (typeof PREDICATE_OPERATORS)[number];

export type PredicateLiteral = string | number | boolean | null;

export type PredicateValue = PredicateLiteral | PredicateLiteral[];

export interface PredicateClause {
  /** Dotted path such as `contact.tags` or `vars.ticket.priority_id`. */
  path: string;
  operator: PredicateOperator;
  /** Literal for single-value operators, a list for `in` / `not_in`, absent for `is_empty` / `is_not_empty`. */
  value?: PredicateValue;
}

export interface PredicateGroup {
  join: 'and' | 'or';
  clauses: Array<PredicateClause | PredicateGroup>;
}

export type PredicateNode = PredicateClause | PredicateGroup;

/** Operators that take no value. */
export const operatorTakesValue = (operator: PredicateOperator): boolean =>
  operator !== 'is_empty' && operator !== 'is_not_empty';

/** Case-sensitive substring, prefix and suffix tests. Their value is a string. */
export const TEXT_OPERATORS: readonly PredicateOperator[] = ['contains', 'starts_with', 'ends_with'];

/**
 * Operators defined as exactly `NOT <positive>` over the full path (relation hops included), so a missing
 * value satisfies them. Every backend resolves them through this one table: evaluate the positive form,
 * then negate. `not_equals` is deliberately absent: a missing value does not satisfy it (see SEMANTICS.md).
 */
export const COMPLEMENTS: Readonly<Partial<Record<PredicateOperator, PredicateOperator>>> = {
  not_in: 'in',
  is_empty: 'is_not_empty',
  not_contains: 'contains',
  not_starts_with: 'starts_with',
  not_ends_with: 'ends_with',
};

/** Operators whose value is a string to look for: the text operators and their complements. */
export const operatorTakesText = (operator: PredicateOperator): boolean =>
  TEXT_OPERATORS.includes(COMPLEMENTS[operator] ?? operator);

/** Operators whose value is a list. */
export const operatorTakesList = (operator: PredicateOperator): boolean =>
  operator === 'in' || operator === 'not_in';

/** Operators that are valid on a set-valued path. `in` = has any of, `not_in` = has none of. */
export const SET_OPERATORS: readonly PredicateOperator[] = ['in', 'not_in', 'is_empty', 'is_not_empty'];

export const isPredicateGroup = (node: PredicateNode): node is PredicateGroup =>
  (node as PredicateGroup).clauses !== undefined;
