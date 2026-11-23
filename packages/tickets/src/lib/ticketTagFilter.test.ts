import { describe, it, expect } from 'vitest';
import { compileTicketTagIdsFilter } from './ticketTagFilter';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const TENANT = '33333333-3333-4333-8333-333333333333';

describe('compileTicketTagIdsFilter', () => {
  it('compiles tag ids through the predicate compiler, deduplicated and bound', () => {
    const compiled = compileTicketTagIdsFilter(TENANT, [A, B, A]);
    expect(compiled.sql).not.toBe('FALSE');
    expect(compiled.bindings).toEqual(expect.arrayContaining([A, B]));
    expect(compiled.bindings.filter((b) => b === A)).toHaveLength(1);
    expect(compiled.bindings).toContain(TENANT);
  });

  it('matches nothing for an empty id list (unresolved tag text)', () => {
    expect(compileTicketTagIdsFilter(TENANT, []).sql).toBe('FALSE');
  });
});
