import { describe, expect, it } from 'vitest';
import { predicateGroupSchema } from '../schema';
import { validatePredicate } from '../querySchema';
import { COMPLEMENTS, TEXT_OPERATORS } from '../types';
import type { PredicateOperator } from '../types';
import type { QuerySchema } from '../querySchema';
import { tagSet } from '../sql/tagSet';

describe('predicate zod schema (T002)', () => {
  it('accepts nested groups', () => {
    const parsed = predicateGroupSchema.safeParse({
      join: 'and',
      clauses: [
        { path: 'a', operator: 'equals', value: 'x' },
        { join: 'or', clauses: [{ path: 'b', operator: 'in', value: ['1', 2] }, { path: 'c', operator: 'is_empty' }] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['unknown operator', { path: 'a', operator: 'like', value: 'x' }],
    ['list for a single-value operator', { path: 'a', operator: 'equals', value: ['x'] }],
    ['scalar for in', { path: 'a', operator: 'in', value: 'x' }],
    ['missing value', { path: 'a', operator: 'equals' }],
    ['value on is_empty', { path: 'a', operator: 'is_empty', value: 'x' }],
    ['extra keys', { path: 'a', operator: 'equals', value: 'x', extra: 1 }],
  ])('rejects %s', (_label, clause) => {
    expect(predicateGroupSchema.safeParse({ join: 'and', clauses: [clause] }).success).toBe(false);
  });
});

const NEGATIVE_TEXT = (Object.keys(COMPLEMENTS) as PredicateOperator[]).filter((operator) =>
  TEXT_OPERATORS.includes(COMPLEMENTS[operator] as PredicateOperator),
);

describe('negative text operators derive from COMPLEMENTS', () => {
  it('covers not_contains, not_starts_with and not_ends_with', () => {
    expect(NEGATIVE_TEXT.sort()).toEqual(['not_contains', 'not_ends_with', 'not_starts_with']);
  });

  it.each(NEGATIVE_TEXT)('%s validates with a single string value (the RMM rule)', (operator) => {
    expect(predicateGroupSchema.safeParse({ join: 'and', clauses: [{ path: 'details', operator, value: 'Sentinel Agent' }] }).success).toBe(true);
  });

  it.each(NEGATIVE_TEXT)('%s rejects a list, a missing value and a non-string value', (operator) => {
    for (const value of [['x'], undefined, 5, null, true]) {
      expect(predicateGroupSchema.safeParse({ join: 'and', clauses: [{ path: 'a', operator, value }] }).success).toBe(false);
    }
  });

  it('not_equals is not a pure complement', () => {
    expect(COMPLEMENTS.not_equals).toBeUndefined();
  });
});

const schema: QuerySchema = {
  table: 'tickets',
  attributes: {
    status_id: { kind: 'column', column: 'status_id', type: 'uuid' },
    title: { kind: 'column', column: 'title', type: 'string' },
    tags: tagSet({ taggedType: 'ticket', local: 'ticket_id' }),
  },
  relations: {
    client: {
      kind: 'one',
      table: 'clients',
      local: 'client_id',
      foreign: 'client_id',
      attributes: { name: { kind: 'column', column: 'client_name', type: 'string' } },
    },
  },
};

describe('query schema validation (T003)', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';

  it('accepts known paths with allowed operators', () => {
    expect(
      validatePredicate(schema, {
        join: 'and',
        clauses: [
          { path: 'status_id', operator: 'in', value: [uuid] },
          { path: 'client.name', operator: 'contains', value: 'a' },
          { path: 'tags', operator: 'not_in', value: [uuid] },
        ],
      }),
    ).toEqual([]);
  });

  it.each(NEGATIVE_TEXT)('allows %s on a string path and rejects it elsewhere', (operator) => {
    expect(validatePredicate(schema, { path: 'client.name', operator, value: 'a' })).toEqual([]);
    expect(validatePredicate(schema, { path: 'title', operator, value: 'a' })).toEqual([]);
    // Not on a set-valued path, nor on a non-string attribute.
    expect(validatePredicate(schema, { path: 'tags', operator, value: 'a' })[0]?.code).toBe('operator_not_allowed');
    expect(validatePredicate(schema, { path: 'status_id', operator, value: 'a' })[0]?.code).toBe('operator_not_allowed');
  });

  it('rejects unknown paths', () => {
    const issues = validatePredicate(schema, { path: 'nope', operator: 'equals', value: 'x' });
    expect(issues[0]?.code).toBe('unknown_path');
    expect(validatePredicate(schema, { path: 'client.nope', operator: 'equals', value: 'x' })[0]?.code).toBe('unknown_path');
  });

  it('rejects operators not allowed for an attribute', () => {
    expect(validatePredicate(schema, { path: 'status_id', operator: 'contains', value: 'x' })[0]?.code).toBe('operator_not_allowed');
    expect(validatePredicate(schema, { path: 'tags', operator: 'equals', value: uuid })[0]?.code).toBe('operator_not_allowed');
  });

  it('rejects values of the wrong type', () => {
    expect(validatePredicate(schema, { path: 'status_id', operator: 'equals', value: 'not-a-uuid' })[0]?.code).toBe('bad_value');
  });
});
