import { describe, expect, it } from 'vitest';
import { ticketWhereSchema } from './ticketWhere';

const UUID = '11111111-1111-4111-8111-111111111111';
const parse = (value: unknown) => ticketWhereSchema.safeParse(value);

describe('ticket where schema (T030)', () => {
  it('accepts a flat and group of known paths', () => {
    expect(
      parse({
        join: 'and',
        clauses: [
          { path: 'contact.tags', operator: 'in', value: [UUID] },
          { path: 'client.tags', operator: 'not_in', value: [UUID] },
          { path: 'due_date', operator: 'is_empty' },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts an empty and group', () => {
    expect(parse({ join: 'and', clauses: [] }).success).toBe(true);
  });

  it('rejects an or group', () => {
    expect(parse({ join: 'or', clauses: [{ path: 'tags', operator: 'is_empty' }] }).success).toBe(false);
  });

  it('rejects a nested group', () => {
    expect(
      parse({ join: 'and', clauses: [{ join: 'and', clauses: [{ path: 'tags', operator: 'is_empty' }] }] }).success,
    ).toBe(false);
  });

  it('rejects unknown paths, disallowed operators and bad values', () => {
    expect(parse({ join: 'and', clauses: [{ path: 'contact.is_vip', operator: 'equals', value: true }] }).success).toBe(false);
    expect(parse({ join: 'and', clauses: [{ path: 'contact.tags', operator: 'contains', value: 'x' }] }).success).toBe(false);
    expect(parse({ join: 'and', clauses: [{ path: 'contact.tags', operator: 'in', value: ['VIP'] }] }).success).toBe(false);
    expect(parse({ join: 'and', clauses: [{ path: 'tags', operator: 'in', value: UUID }] }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(parse({ join: 'and', clauses: [], extra: true }).success).toBe(false);
  });
});
