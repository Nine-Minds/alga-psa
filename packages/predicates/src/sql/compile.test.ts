import knex from 'knex';
import { describe, expect, it } from 'vitest';
import { compilePredicateFragment } from './compile';
import { PredicateSchemaError } from '../querySchema';
import type { QuerySchema } from '../querySchema';

const schema: QuerySchema = {
  table: 'tickets',
  attributes: {
    title: { kind: 'column', column: 'title', type: 'string' },
    priority: { kind: 'column', column: 'priority', type: 'number' },
  },
};

describe('compilePredicateFragment Knex bindings', () => {
  it('produces raw fragments Knex can compile with scalar and identifier bindings', () => {
    const fragment = compilePredicateFragment(schema, {
      join: 'and',
      clauses: [
        { path: 'title', operator: 'equals', value: 'Printer offline' },
        { path: 'priority', operator: 'in', value: [1, 2, 3] },
      ],
    }, { rootAlias: 't' });
    const db = knex({ client: 'pg' });

    try {
      const compiled = db.raw(fragment.sql, fragment.bindings).toSQL().toNative();
      expect(compiled.sql).toContain('"t"."title"');
      expect(compiled.bindings).toEqual(['Printer offline', 1, 2, 3]);
    } finally {
      void db.destroy();
    }
  });

  it('rejects runtime predicate values outside the supported literal model', () => {
    const persistedPredicate = JSON.parse('{"path":"title","operator":"equals","value":{"unsupported":true}}');
    expect(() => compilePredicateFragment(schema, persistedPredicate, { rootAlias: 't' })).toThrow(PredicateSchemaError);
  });
});
