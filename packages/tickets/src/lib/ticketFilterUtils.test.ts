// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  normalizeAssignedToIds,
  parseReturnFilters,
  UNASSIGNED_FILTER_SENTINEL,
} from './ticketFilterUtils';

const USER_A = '11111111-2222-4333-8444-555555555555';
const USER_B = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee';

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
