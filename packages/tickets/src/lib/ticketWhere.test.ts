import { describe, expect, it } from 'vitest';
import { sanitizeTicketWhere, TICKET_WHERE_MAX_TICKET_IDS, ticketWhereSchema } from './ticketWhere';

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

describe('ticket_id clause (T002)', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const clause = (count: number) => ({ path: 'ticket_id', operator: 'in', value: Array.from({ length: count }, (_, i) => uuid(i)) });

  it('accepts a ticket_id in-clause up to the shared cap', () => {
    expect(ticketWhereSchema.safeParse({ join: 'and', clauses: [clause(TICKET_WHERE_MAX_TICKET_IDS)] }).success).toBe(true);
  });

  it('refuses more than the cap, independently of the clause-count cap', () => {
    const result = ticketWhereSchema.safeParse({ join: 'and', clauses: [clause(TICKET_WHERE_MAX_TICKET_IDS + 1)] });
    expect(result.success).toBe(false);
    expect(sanitizeTicketWhere({ join: 'and', clauses: [clause(TICKET_WHERE_MAX_TICKET_IDS + 1)] }).where).toBeUndefined();
    expect(sanitizeTicketWhere({ join: 'and', clauses: [clause(3)] }).where?.clauses).toHaveLength(1);
  });

  it('only supports the in operator', () => {
    expect(ticketWhereSchema.safeParse({ join: 'and', clauses: [{ path: 'ticket_id', operator: 'equals', value: uuid(1) }] }).success).toBe(false);
  });
});
