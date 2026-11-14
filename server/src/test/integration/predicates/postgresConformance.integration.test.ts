import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import table from '../../../../../packages/predicates/spec/conformance.json';
import type { ConformanceTable } from '../../../../../packages/predicates/src/conformance';
import { compilePredicateFragment } from '../../../../../packages/predicates/src/sql/compile';
import type { QuerySchema } from '../../../../../packages/predicates/src/querySchema';

const conformance = table as unknown as ConformanceTable;
const schema: QuerySchema = { table: 'predicate_conformance', attributes: { s: { kind: 'column', column: 's', type: 'string' } } };
let db: Knex;

async function evaluateSql(predicate: unknown, value: unknown): Promise<boolean> {
  const fragment = compilePredicateFragment(schema, predicate as never, { rootAlias: 'a' });
  const result = await db.raw(`SELECT (${fragment.sql}) AS matched FROM (SELECT ?::text AS s) AS a`, [...fragment.bindings, value]);
  return result.rows[0].matched;
}

describe('predicate SQL backend against PostgreSQL', () => {
  beforeAll(async () => { db = await createTestDbConnection({ runSeeds: false, recreate: false }); }, 180_000);
  afterAll(async () => { await db?.destroy(); });

  for (const testCase of conformance.cases.filter(test => ['scalar-not-contains', 'scalar-contains-ci', 'scalar-not-contains-ci', 'scalar-contains-ci-like-metacharacters'].includes(test.id))) {
    describe(testCase.id, () => {
      for (const row of testCase.rows) {
        it(`${row.id} returns ${row.expected}`, async () => {
          const recordValue = (row.record as Record<string, unknown>).s ?? null;
          expect(await evaluateSql(testCase.predicate, recordValue)).toBe(row.expected);
        });
      }
    });
  }

  it('treats SQL pattern metacharacters as literal text and preserves case semantics', async () => {
    const predicate = { path: 's', operator: 'contains_ci' as const, value: '%_\\' };
    expect(await evaluateSql(predicate, 'prefix %_\\ suffix')).toBe(true);
    expect(await evaluateSql(predicate, 'prefix xx suffix')).toBe(false);
    expect(await evaluateSql({ path: 's', operator: 'contains', value: 'sentinel' }, 'SENTINEL service')).toBe(false);
  });
});
