import { readPath } from './path';
import { COMPLEMENTS, TEXT_OPERATORS, isPredicateGroup } from './types';
import type { PredicateClause, PredicateLiteral, PredicateNode } from './types';

const isMissing = (value: unknown): boolean => value === undefined || value === null;

const isPlainScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const compare = (left: unknown, right: unknown): number | null => {
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : left > right ? 1 : 0;
  return null;
};

const listOf = (value: PredicateClause['value']): PredicateLiteral[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

const single = (value: PredicateClause['value']): PredicateLiteral =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

/** Scalar form of a positive operator (complements are resolved by `evaluateClause`). Two-valued: never throws, never "unknown". */
const evaluateScalar = (clause: PredicateClause, actual: unknown): boolean => {
  const { operator } = clause;
  switch (operator) {
    case 'is_not_empty':
      return !(isMissing(actual) || actual === '');
    case 'in':
      return isPlainScalar(actual) && listOf(clause.value).some((candidate) => candidate === actual);
    default:
      break;
  }

  const expected = single(clause.value);
  // Comparing against null asks "is there a value": it follows is_empty / is_not_empty.
  if (expected === null) {
    if (operator === 'equals') return isMissing(actual);
    if (operator === 'not_equals') return !isMissing(actual);
    return false;
  }
  // A missing value never satisfies a comparison, `not_equals` included.
  if (!isPlainScalar(actual)) return false;

  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return typeof actual === typeof expected && actual !== expected;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const order = compare(actual, expected);
      if (order === null) return false;
      return operator === 'gt' ? order > 0 : operator === 'gte' ? order >= 0 : operator === 'lt' ? order < 0 : order <= 0;
    }
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
    case 'starts_with':
      return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    case 'ends_with':
      return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
    default:
      return false;
  }
};

/** Set form of a positive operator: `in` = has any of, `is_not_empty` = some element, text tests = some element passes. */
const evaluateSet = (clause: PredicateClause, elements: unknown[]): boolean => {
  const present = elements.filter(isPlainScalar);
  switch (clause.operator) {
    case 'is_not_empty':
      return present.length > 0;
    case 'in':
      return present.some((element) => listOf(clause.value).includes(element));
    default:
      // A text test over several values (a `many` relation hop) means "some row passes".
      if (TEXT_OPERATORS.includes(clause.operator)) return present.some((element) => evaluateScalar(clause, element));
      // Comparisons are not defined on sets (query schemas reject them); never satisfied.
      return false;
  }
};

export const evaluateClause = (clause: PredicateClause, record: unknown): boolean => {
  // Complements are `NOT <positive>` over the full path, so they are resolved before any missing-value
  // or type guard: a missing or non-string value satisfies `not_contains`.
  const positive = COMPLEMENTS[clause.operator];
  if (positive) return !evaluateClause({ ...clause, operator: positive }, record);
  const actual = readPath(record, clause.path);
  return Array.isArray(actual) ? evaluateSet(clause, actual) : evaluateScalar(clause, actual);
};

/** Evaluates a predicate against a plain record. An empty `and` group is true; an empty `or` group is false. */
export const evaluatePredicate = (node: PredicateNode, record: unknown): boolean => {
  if (!isPredicateGroup(node)) return evaluateClause(node, record);
  if (node.join === 'and') return node.clauses.every((child) => evaluatePredicate(child, record));
  return node.clauses.some((child) => evaluatePredicate(child, record));
};
