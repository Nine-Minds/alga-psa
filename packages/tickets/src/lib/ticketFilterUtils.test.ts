// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { encodeTicketWhere } from './ticketWhereUrl';
import {
  contactFilterUpdateForClientChange,
  normalizeAssignedToIdList,
  normalizeAssignedToIds,
  parseReturnFilters,
  UNASSIGNED_FILTER_SENTINEL,
} from './ticketFilterUtils';

const USER_A = '11111111-2222-4333-8444-555555555555';
const USER_B = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee';
const CLIENT_A = '22222222-3333-4444-8555-666666666666';
const CLIENT_B = '33333333-4444-4555-8666-777777777777';
const CONTACT_A = '44444444-5555-4666-8777-888888888888';

describe('normalizeAssignedToIds', () => {
  it('returns an empty result for null, undefined, and empty input', () => {
    expect(normalizeAssignedToIds(null)).toEqual({});
    expect(normalizeAssignedToIds(undefined)).toEqual({});
    expect(normalizeAssignedToIds('')).toEqual({});
  });

  it('passes well-formed assignee ids through', () => {
    expect(normalizeAssignedToIds(`${USER_A},${USER_B}`)).toEqual({
      assignedToIds: [USER_A, USER_B],
    });
  });

  it('drops junk tokens so the uuid schema never sees them', () => {
    // A hand-edited or stale URL must degrade to the valid part of the filter,
    // not throw the whole list into an error state.
    expect(normalizeAssignedToIds(`foo,${USER_A},12345,null`)).toEqual({
      assignedToIds: [USER_A],
    });
  });

  it('ignores empty tokens from trailing or doubled commas', () => {
    expect(normalizeAssignedToIds(`${USER_A},, ,`)).toEqual({
      assignedToIds: [USER_A],
    });
  });

  it('translates the unassigned sentinel to includeUnassigned', () => {
    expect(normalizeAssignedToIds(UNASSIGNED_FILTER_SENTINEL)).toEqual({
      includeUnassigned: true,
    });
    expect(normalizeAssignedToIds(`${USER_A},${UNASSIGNED_FILTER_SENTINEL}`)).toEqual({
      assignedToIds: [USER_A],
      includeUnassigned: true,
    });
  });

  it('dedupes repeated ids', () => {
    expect(normalizeAssignedToIds(`${USER_A},${USER_A},${USER_B}`)).toEqual({
      assignedToIds: [USER_A, USER_B],
    });
  });

  it('returns no assignedToIds key when every token is junk', () => {
    expect(normalizeAssignedToIds('foo,bar')).toEqual({});
  });
});

describe('normalizeAssignedToIdList', () => {
  it('keeps valid UUIDs and drops legacy non-UUID tokens', () => {
    // A stored board/tenant view can retain arbitrary strings from an older or
    // hand-written document. Those must never reach the UUID-only list schema.
    expect(normalizeAssignedToIdList(['legacy-token', USER_A, '12345', null as unknown as string]))
      .toEqual([USER_A]);
  });

  it('deduplicates valid UUIDs', () => {
    expect(normalizeAssignedToIdList([USER_A, USER_A, USER_B])).toEqual([USER_A, USER_B]);
  });

  it('drops the unassigned sentinel rather than forwarding it as an id', () => {
    expect(normalizeAssignedToIdList([UNASSIGNED_FILTER_SENTINEL, USER_A])).toEqual([USER_A]);
  });

  it('returns undefined when nothing survives, so the key is omitted', () => {
    expect(normalizeAssignedToIdList(['legacy-token'])).toBeUndefined();
    expect(normalizeAssignedToIdList([])).toBeUndefined();
    expect(normalizeAssignedToIdList(undefined)).toBeUndefined();
  });
});

describe('parseReturnFilters assignee handling', () => {
  it('round-trips valid assignee ids', () => {
    const filters = parseReturnFilters(
      encodeURIComponent(`assignedToIds=${USER_A},${USER_B}`),
    );
    expect(filters.assignedToIds).toEqual([USER_A, USER_B]);
    expect(filters.includeUnassigned).toBeUndefined();
  });

  it('drops junk assignee tokens instead of forwarding them to the query', () => {
    const filters = parseReturnFilters(
      encodeURIComponent(`assignedToIds=garbage,${USER_A}`),
    );
    expect(filters.assignedToIds).toEqual([USER_A]);
  });

  it('maps the unassigned sentinel onto includeUnassigned', () => {
    const filters = parseReturnFilters(
      encodeURIComponent(`assignedToIds=${UNASSIGNED_FILTER_SENTINEL}`),
    );
    expect(filters.assignedToIds).toBeUndefined();
    expect(filters.includeUnassigned).toBe(true);
  });

  it('keeps the explicit includeUnassigned flag working', () => {
    const filters = parseReturnFilters(encodeURIComponent('includeUnassigned=true'));
    expect(filters.includeUnassigned).toBe(true);
  });
});

describe('contactFilterUpdateForClientChange (client row ↔ contact cross-link)', () => {
  const row = (mode: 'in' | 'not_in', ...ids: string[]) => ({ mode, ids });
  const whereOf = (mode: 'in' | 'not_in', ...ids: string[]) =>
    ({ join: 'and', clauses: [{ path: 'client.id', operator: mode, value: ids }] });
  const OTHER = { path: 'contact.tags', operator: 'in' as const, value: ['t1'] };

  it('writes the row and leaves other clauses alone when no contact is applied', () => {
    const update = contactFilterUpdateForClientChange({
      currentWhere: { join: 'and', clauses: [OTHER] },
      nextSelection: row('in', CLIENT_A),
      currentContactId: null,
    });
    expect(update.where).toEqual({ join: 'and', clauses: [OTHER, { path: 'client.id', operator: 'in', value: [CLIENT_A] }] });
    expect(update.contactId).toBeUndefined();
  });

  it('keeps the contact when its client is listed in an in row', () => {
    expect(contactFilterUpdateForClientChange({
      currentWhere: undefined,
      nextSelection: row('in', CLIENT_A, CLIENT_B),
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    }).contactId).toBe(CONTACT_A);
  });

  it('clears the contact when its client is not listed in an in row', () => {
    expect(contactFilterUpdateForClientChange({
      currentWhere: undefined,
      nextSelection: row('in', CLIENT_B),
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    }).contactId).toBeUndefined();
  });

  it('clears the contact when its client is listed in a not_in row, and keeps it otherwise', () => {
    expect(contactFilterUpdateForClientChange({
      currentWhere: undefined,
      nextSelection: row('not_in', CLIENT_A),
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    }).contactId).toBeUndefined();
    expect(contactFilterUpdateForClientChange({
      currentWhere: undefined,
      nextSelection: row('not_in', CLIENT_B),
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    }).contactId).toBe(CONTACT_A);
  });

  it('keeps the contact when the row is removed, and drops the row from where', () => {
    const update = contactFilterUpdateForClientChange({
      currentWhere: whereOf('in', CLIENT_A) as any,
      nextSelection: null,
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    });
    expect(update.contactId).toBe(CONTACT_A);
    expect(update.where).toBeUndefined();
  });

  it('clears the contact when its ownership is unknown and a row applies', () => {
    expect(contactFilterUpdateForClientChange({
      currentWhere: undefined,
      nextSelection: row('in', CLIENT_B),
      currentContactId: CONTACT_A,
    }).contactId).toBeUndefined();
  });

  it('always names every key, so the update clears rather than merges', () => {
    const update = contactFilterUpdateForClientChange({
      currentWhere: undefined,
      nextSelection: row('in', CLIENT_B),
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    });
    expect(Object.keys(update).sort()).toEqual(['clientId', 'contactId', 'where']);
    expect(update.clientId).toBeUndefined();
  });
});

describe('legacy clientId folding in URL parsers', () => {
  it('parseReturnFilters folds ?clientId= into an Any-of client.id row', () => {
    const filters = parseReturnFilters(encodeURIComponent(`clientId=${CLIENT_A}`));
    expect(filters.clientId).toBeUndefined();
    expect(filters.where).toEqual({ join: 'and', clauses: [{ path: 'client.id', operator: 'in', value: [CLIENT_A] }] });
  });

  it('an explicit client row in the URL wins over clientId', () => {
    const where = encodeTicketWhere({ join: 'and', clauses: [{ path: 'client.id', operator: 'not_in', value: [CLIENT_B] }] });
    const filters = parseReturnFilters(encodeURIComponent(`clientId=${CLIENT_A}&where=${where}`));
    expect(filters.clientId).toBeUndefined();
    expect(filters.where?.clauses).toEqual([{ path: 'client.id', operator: 'not_in', value: [CLIENT_B] }]);
  });

  it('encoding a not_in row and parsing it back yields the same where', () => {
    const original = { join: 'and', clauses: [{ path: 'client.id', operator: 'not_in', value: [CLIENT_A, CLIENT_B] }] } as const;
    const params = new URLSearchParams({ where: encodeTicketWhere(original as any)! });
    expect(parseReturnFilters(encodeURIComponent(params.toString())).where).toEqual(original);
  });
});

describe('parseReturnFilters contact handling', () => {
  it('round-trips the contact filter', () => {
    const filters = parseReturnFilters(encodeURIComponent(`contactId=${CONTACT_A}`));
    expect(filters.contactId).toBe(CONTACT_A);
  });

  it('leaves the contact filter unset when the URL carries none', () => {
    expect(parseReturnFilters(encodeURIComponent('statusId=open')).contactId).toBeUndefined();
  });
});
