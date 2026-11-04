import { describe, expect, it } from 'vitest';
import table from '../../spec/conformance.json';
import { checkConformanceCompleteness } from '../conformance';
import type { ConformanceTable } from '../conformance';
import { evaluatePredicate } from '../evaluate';

const conformance = table as unknown as ConformanceTable;

describe('conformance table on the in-memory evaluator (T001)', () => {
  for (const testCase of conformance.cases) {
    describe(testCase.id, () => {
      for (const row of testCase.rows) {
        it(`${row.id} -> ${row.expected}`, () => {
          expect(evaluatePredicate(testCase.predicate, row.record)).toBe(row.expected);
        });
      }
    });
  }
});

describe('conformance completeness (T028)', () => {
  it('passes for the shipped table', () => {
    expect(checkConformanceCompleteness(conformance)).toEqual([]);
  });

  it('reports a missing operator and a missing path kind', () => {
    const trimmed: ConformanceTable = {
      version: 1,
      cases: conformance.cases.filter((c) => c.id !== 'scalar-gte' && c.covers.pathKind !== 'group'),
    };
    const gaps = checkConformanceCompleteness(trimmed);
    expect(gaps).toContain('no scalar case for operator gte');
    expect(gaps).toContain('no nested group case');
  });

  it('reports a set operator with no case', () => {
    const trimmed: ConformanceTable = {
      version: 1,
      cases: conformance.cases.filter((c) => c.id !== 'set-not-in'),
    };
    expect(checkConformanceCompleteness(trimmed)).toContain('no set case for operator not_in');
  });
});
