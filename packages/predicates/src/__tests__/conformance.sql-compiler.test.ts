import { describe, expect, it } from 'vitest';
import { compilePredicateFragment } from '../sql/compile';
import type { QuerySchema } from '../querySchema';
import type { PredicateOperator } from '../types';

const schema: QuerySchema = {
  table: 'alerts',
  attributes: { text: { kind: 'column', column: 'message', type: 'string' } },
};

describe('SQL compiler negative and case-insensitive text operators', () => {
  it.each([
    ['not_contains', 'NOT LIKE'],
    ['contains_ci', 'ILIKE'],
    ['not_contains_ci', 'NOT ILIKE'],
  ] as const)('%s emits a two-valued text predicate', (operator, sqlOperator) => {
    const fragment = compilePredicateFragment(schema, { path: 'text', operator: operator as PredicateOperator, value: 'Sentinel' }, { rootAlias: 'a' });
    expect(fragment.sql).toContain(sqlOperator);
    expect(fragment.sql).toContain('COALESCE');
    expect(fragment.bindings).toContain('%Sentinel%');
  });
});
