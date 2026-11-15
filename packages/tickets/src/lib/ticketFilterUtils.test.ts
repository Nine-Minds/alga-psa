// @vitest-environment node

import { describe, expect, it } from 'vitest';
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

describe('contactFilterUpdateForClientChange (client ↔ contact cross-link)', () => {
  it('emits the client alone when no contact is applied', () => {
    expect(contactFilterUpdateForClientChange({
      nextClientId: CLIENT_A,
      currentContactId: null,
    })).toEqual({ clientId: CLIENT_A, contactId: undefined });
  });

  it('keeps the contact when the client filter is cleared', () => {
    // With no client selected every contact is reachable again, so the already
    // applied contact is still a legal — and intentional — filter.
    expect(contactFilterUpdateForClientChange({
      nextClientId: null,
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    })).toEqual({ clientId: undefined, contactId: CONTACT_A });
  });

  it('treats an empty client string as no client', () => {
    expect(contactFilterUpdateForClientChange({
      nextClientId: '',
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    })).toEqual({ clientId: undefined, contactId: CONTACT_A });
  });

  it('keeps the contact when it belongs to the newly selected client', () => {
    expect(contactFilterUpdateForClientChange({
      nextClientId: CLIENT_A,
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    })).toEqual({ clientId: CLIENT_A, contactId: CONTACT_A });
  });

  it('clears the contact when it belongs to a different client', () => {
    // Otherwise the list would be filtered to an impossible pair and come back
    // empty, which reads as a bug rather than as a filter.
    expect(contactFilterUpdateForClientChange({
      nextClientId: CLIENT_B,
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    })).toEqual({ clientId: CLIENT_B, contactId: undefined });
  });

  it('clears the contact when its ownership is unknown', () => {
    // Unknown means the contact is absent from the client-scoped option list,
    // which is exactly the evidence that it is not this client's contact.
    expect(contactFilterUpdateForClientChange({
      nextClientId: CLIENT_B,
      currentContactId: CONTACT_A,
    })).toEqual({ clientId: CLIENT_B, contactId: undefined });
    expect(contactFilterUpdateForClientChange({
      nextClientId: CLIENT_B,
      currentContactId: CONTACT_A,
      contactClientId: null,
    })).toEqual({ clientId: CLIENT_B, contactId: undefined });
  });

  it('always names both keys, so the update clears rather than merges', () => {
    // handleFilterChange merges the update onto the live filters, so a dropped
    // contact has to arrive as an explicit undefined — omitting the key would
    // leave the stale contact filter applied.
    const update = contactFilterUpdateForClientChange({
      nextClientId: CLIENT_B,
      currentContactId: CONTACT_A,
      contactClientId: CLIENT_A,
    });
    expect(Object.keys(update).sort()).toEqual(['clientId', 'contactId']);
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
