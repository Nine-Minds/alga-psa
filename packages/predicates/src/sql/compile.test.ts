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

  // Citus cannot route `EXISTS (...) OR EXISTS (...)` to one shard unless each subquery carries the
  // tenant as a constant; correlation to the outer row alone fails with 0A000 in production.
  it('pins every subquery to the tenant by value when a tenant is given', () => {
    const related: QuerySchema = {
      table: 'tickets',
      children: { childColumn: 'master_ticket_id', parentColumn: 'ticket_id' },
      attributes: {
        tags: { kind: 'set', table: 'tag_mappings', local: 'ticket_id', foreign: 'tagged_id', valueColumn: 'tag_id', valueType: 'uuid' },
      },
      relations: {
        contact: {
          kind: 'one',
          table: 'contacts',
          local: 'contact_name_id',
          foreign: 'contact_name_id',
          attributes: { id: { kind: 'column', column: 'contact_name_id', type: 'uuid' } },
        },
      },
    };
    const predicate = {
      join: 'and' as const,
      clauses: [
        { path: 'contact.id', operator: 'equals' as const, value: '11111111-1111-4111-8111-111111111111' },
        { path: 'tags', operator: 'in' as const, value: ['22222222-2222-4222-8222-222222222222'] },
      ],
    };
    const subqueries = (sql: string) => (sql.match(/EXISTS \(SELECT 1 FROM/g) ?? []).length;
    const pins = (bindings: readonly unknown[]) => bindings.filter((binding) => binding === 'tenant-1').length;

    const pinned = compilePredicateFragment(related, predicate, { rootAlias: 't', selfOrAnyChild: true, tenant: 'tenant-1' });
    // contact: self + (child ticket + its contact); tags: self + (child ticket + its tags).
    expect(subqueries(pinned.sql)).toBe(6);
    expect(pins(pinned.bindings)).toBe(6);

    const unpinned = compilePredicateFragment(related, predicate, { rootAlias: 't', selfOrAnyChild: true });
    expect(subqueries(unpinned.sql)).toBe(6);
    expect(pins(unpinned.bindings)).toBe(0);
  });

  it('rejects runtime predicate values outside the supported literal model', () => {
    const persistedPredicate = JSON.parse('{"path":"title","operator":"equals","value":{"unsupported":true}}');
    expect(() => compilePredicateFragment(schema, persistedPredicate, { rootAlias: 't' })).toThrow(PredicateSchemaError);
  });
});
