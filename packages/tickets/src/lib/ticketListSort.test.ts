// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TICKET_LIST_SORT_KEY,
  isTicketListSortKey,
  normalizeTicketListSortKey,
  TICKET_LIST_SORT_KEYS,
} from './ticketListSort';

describe('ticket list sort contract', () => {
  it('includes every key the board emits, including the assignee columns', () => {
    for (const key of [
      'assigned_to_name',
      'assigned_team_name',
      'updated_at',
      'entered_at',
      'due_date',
    ]) {
      expect(TICKET_LIST_SORT_KEYS).toContain(key);
    }
  });

  it('recognizes only supported keys', () => {
    expect(isTicketListSortKey('assigned_to_name')).toBe(true);
    expect(isTicketListSortKey('updated_at')).toBe(true);
    expect(isTicketListSortKey('assigned_to_ids')).toBe(false);
    expect(isTicketListSortKey(undefined)).toBe(false);
    expect(isTicketListSortKey(42)).toBe(false);
  });

  it('normalizes unknown or absent values to the default', () => {
    expect(normalizeTicketListSortKey('assigned_to_name')).toBe('assigned_to_name');
    expect(normalizeTicketListSortKey('not-a-key')).toBe(DEFAULT_TICKET_LIST_SORT_KEY);
    expect(normalizeTicketListSortKey(null)).toBe(DEFAULT_TICKET_LIST_SORT_KEY);
  });
});
