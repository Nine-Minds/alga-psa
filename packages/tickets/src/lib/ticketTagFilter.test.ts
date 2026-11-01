import { describe, it, expect } from 'vitest';
import { compileTicketTagIdsFilter } from './ticketTagFilter';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('compileTicketTagIdsFilter', () => {
  it('compiles tag ids through the predicate compiler, deduplicated and bound', () => {
    const compiled = compileTicketTagIdsFilter([A, B, A]);
    expect(compiled.sql).not.toBe('FALSE');
    expect(compiled.bindings).toEqual(expect.arrayContaining([A, B]));
    expect(compiled.bindings.filter((b) => b === A)).toHaveLength(1);
  });

  it('matches nothing for an empty id list (unresolved tag text)', () => {
    expect(compileTicketTagIdsFilter([]).sql).toBe('FALSE');
  });
});
