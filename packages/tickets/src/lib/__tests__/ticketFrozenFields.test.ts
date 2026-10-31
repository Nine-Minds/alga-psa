import { describe, expect, it } from 'vitest';
import { TICKET_SCREEN_FIELDS, resolveTicketFrozenFields } from '../ticketDataSource';

describe('resolveTicketFrozenFields', () => {
  it('freezes every screen field on a read-only screen', () => {
    expect(TICKET_SCREEN_FIELDS).toHaveLength(18);
    expect(resolveTicketFrozenFields({ readOnly: true })).toEqual([...TICKET_SCREEN_FIELDS]);
  });

  it('unions the source frozen fields with live conflicts, screen fields first, without duplicates', () => {
    expect(
      resolveTicketFrozenFields({ frozenFields: ['title', 'client_id'] }, ['client_id', 'due_date']),
    ).toEqual(['title', 'client_id', 'due_date']);
  });

  it('is empty for a writable screen with nothing frozen and no conflicts', () => {
    expect(resolveTicketFrozenFields({ readOnly: false, frozenFields: [] }, [])).toEqual([]);
    expect(resolveTicketFrozenFields({})).toEqual([]);
  });

  it('keeps live conflicts on a writable screen', () => {
    expect(resolveTicketFrozenFields({}, ['status_id'])).toEqual(['status_id']);
  });
});
