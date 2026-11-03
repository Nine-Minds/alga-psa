import { describe, expect, it } from 'vitest';
import type { PredicateGroup } from '@alga-psa/predicates';
import { decodeTicketWhere, encodeTicketWhere } from './ticketWhereUrl';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const group = (...clauses: PredicateGroup['clauses']): PredicateGroup => ({ join: 'and', clauses });

describe('where URL v1', () => {
  it('round-trips list, scalar and valueless operators', () => {
    const where = group(
      { path: 'contact.tags', operator: 'in', value: [ID1, ID2] },
      { path: 'client.tags', operator: 'not_in', value: [ID1] },
      { path: 'tags', operator: 'is_empty' },
      { path: 'status_name', operator: 'equals', value: 'Waiting; on: "client", ok' },
      { path: 'board_inactive', operator: 'equals', value: false },
    );
    const encoded = encodeTicketWhere(where);
    expect(encoded.startsWith('v1:')).toBe(true);
    expect(encoded).not.toMatch(/[ "]/);
    expect(decodeTicketWhere(encoded)).toEqual({ where, dropped: 0 });
  });

  it('keeps strings that look like literals as strings', () => {
    const where = group({ path: 'status_name', operator: 'equals', value: 'true' }, { path: 'status_name', operator: 'equals', value: '~x' });
    expect(decodeTicketWhere(encodeTicketWhere(where)).where).toEqual(where);
  });

  it('survives a trip through URLSearchParams', () => {
    const where = group({ path: 'status_name', operator: 'equals', value: 'a&b=c+d%' });
    const params = new URLSearchParams({ where: encodeTicketWhere(where) });
    expect(decodeTicketWhere(new URLSearchParams(params.toString()).get('where')).where).toEqual(where);
  });

  it('drops unknown versions and malformed clauses, counting them', () => {
    expect(decodeTicketWhere('v2:tags:is_empty')).toEqual({ dropped: 1 });
    const out = decodeTicketWhere(`v1:contact.tags:in:${ID1};nope.path:in:x;tags:wat;tags:is_empty`);
    expect(out.dropped).toBe(2);
    expect(out.where?.clauses).toHaveLength(2);
    expect(decodeTicketWhere('')).toEqual({ dropped: 0 });
  });

  it('writes nothing for an empty where', () => {
    expect(encodeTicketWhere(group())).toBe('');
    expect(encodeTicketWhere(undefined)).toBe('');
  });
});
