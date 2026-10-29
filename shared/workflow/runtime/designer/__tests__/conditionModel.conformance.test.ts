import { describe, expect, it } from 'vitest';
import type { ConformanceCase, ConformanceTable } from '@alga-psa/predicates';
import { isPredicateGroup } from '@alga-psa/predicates';
import table from '../../../../../packages/predicates/spec/conformance.json';
import { serializeConditionClause, serializeConditionGroup } from '../conditionModel';
import type { WorkflowConditionClause } from '../conditionModel';
import { evaluateExpressionSource } from '../../expressionEngine';

/**
 * T027: the shared conformance table through the workflow path: adapter serialize, then expressionEngine.
 * The adapter's builder model is flat, so nested groups are flattened by hand here (join is applied by
 * JSONata operators); anything the table marks `skip.jsonata` is asserted to be flagged, not run.
 */
const conformance = table as unknown as ConformanceTable;

const toExpression = (testCase: ConformanceCase): string => {
  const predicate = testCase.predicate;
  if (!isPredicateGroup(predicate)) return serializeConditionClause(predicate as WorkflowConditionClause);
  const render = (node: typeof predicate): string => {
    const parts = node.clauses.map((child) =>
      isPredicateGroup(child) ? `(${render(child)})` : serializeConditionClause(child as WorkflowConditionClause),
    );
    return parts.join(` ${node.join} `);
  };
  return render(predicate);
};

describe('conformance table on the workflow JSONata path (T027)', () => {
  for (const testCase of conformance.cases) {
    if (testCase.skip?.jsonata) {
      it(`${testCase.id}: flagged as unrepresentable (${testCase.skip.jsonata})`, () => {
        expect(testCase.skip?.jsonata).toBeTruthy();
      });
      continue;
    }
    describe(testCase.id, () => {
      const expression = toExpression(testCase);
      for (const row of testCase.rows) {
        it(`${row.id} -> ${row.expected}`, async () => {
          // Known disagreement (SEMANTICS.md): ordering a missing value yields `undefined` in JSONata, which the
          // engine rejects as "not JSON-serializable". Treat that rejection as "not satisfied".
          const result = await evaluateExpressionSource(expression, row.record as Record<string, unknown>).catch(
            (error: Error) => (/not JSON-serializable/.test(error.message) ? false : Promise.reject(error)),
          );
          expect(result === true).toBe(row.expected);
        });
      }
    });
  }

  it('serializeConditionGroup agrees with the hand-rendered flat form', () => {
    const flat = conformance.cases.find((c) => c.id === 'group-and')!;
    expect(serializeConditionGroup(flat.predicate as never)).toBe(toExpression(flat));
  });
});
