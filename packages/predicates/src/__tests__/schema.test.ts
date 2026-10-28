import { describe, expect, it } from 'vitest';
import { predicateGroupSchema } from '../schema';
import { validatePredicate } from '../querySchema';
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
