import { PREDICATE_OPERATORS } from './types';
import type { PredicateGroup, PredicateNode, PredicateOperator } from './types';

/**
 * Shape of `spec/conformance.json`. Every backend (evaluator, SQL compiler, workflow JSONata path) runs
 * every case; a backend may only opt out through `skip`, with a reason.
 */
export interface ConformanceRow {
  id: string;
  /** Scalar fields `s` (string), `n` (number), `b` (boolean) and set field `tags` (strings). Absent = missing. */
  record: Record<string, unknown>;
  expected: boolean;
}

export interface ConformanceCase {
  id: string;
  description: string;
  /** Operators and path kinds this case covers, for the completeness check. */
  covers: { operators: PredicateOperator[]; pathKind: 'scalar' | 'set' | 'group' };
  predicate: PredicateNode;
  rows: ConformanceRow[];
  /** Backends that cannot run the case, with the reason. */
  skip?: { jsonata?: string; sql?: string };
}

export interface ConformanceTable {
  version: 1;
  cases: ConformanceCase[];
}

const SET_COVERED_OPERATORS: PredicateOperator[] = ['in', 'not_in', 'is_empty', 'is_not_empty'];

/** Returns the gaps in a table: operators or path kinds with no case. Empty means complete. */
export const checkConformanceCompleteness = (table: ConformanceTable): string[] => {
  const gaps: string[] = [];
  const scalar = new Set<PredicateOperator>();
  const set = new Set<PredicateOperator>();
  let group = false;
  const ids = new Set<string>();
  for (const testCase of table.cases) {
    if (ids.has(testCase.id)) gaps.push(`duplicate case id ${testCase.id}`);
    ids.add(testCase.id);
    if (testCase.rows.length === 0) gaps.push(`case ${testCase.id} has no rows`);
    if (!testCase.rows.some((row) => row.expected) || !testCase.rows.some((row) => !row.expected)) {
      gaps.push(`case ${testCase.id} needs both a matching and a non-matching row`);
    }
    for (const operator of testCase.covers.operators) {
      if (testCase.covers.pathKind === 'scalar') scalar.add(operator);
      if (testCase.covers.pathKind === 'set') set.add(operator);
    }
    if (testCase.covers.pathKind === 'group') group = true;
  }
  for (const operator of PREDICATE_OPERATORS) {
    if (!scalar.has(operator)) gaps.push(`no scalar case for operator ${operator}`);
  }
  for (const operator of SET_COVERED_OPERATORS) {
    if (!set.has(operator)) gaps.push(`no set case for operator ${operator}`);
  }
  if (!group) gaps.push('no nested group case');
  return gaps;
};

export type { PredicateGroup };
