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

/** Operators whose value is a list. */
export const operatorTakesList = (operator: PredicateOperator): boolean =>
  operator === 'in' || operator === 'not_in';

/** Operators that are valid on a set-valued path. `in` = has any of, `not_in` = has none of. */
export const SET_OPERATORS: readonly PredicateOperator[] = ['in', 'not_in', 'is_empty', 'is_not_empty'];

export const isPredicateGroup = (node: PredicateNode): node is PredicateGroup =>
  (node as PredicateGroup).clauses !== undefined;
