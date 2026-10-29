import { describe, expect, it } from 'vitest';
import { daysHeldSince, describeCustodyHistory, formatCustodyPlace, isFollowUpOverdue } from './custodyDisplay';

const t = (key: string, options?: Record<string, unknown>) => {
  let result = String(options?.defaultValue ?? key);
  for (const [name, value] of Object.entries(options ?? {})) {
    if (name !== 'defaultValue') result = result.replace(`{{${name}}}`, String(value));
  }
  return result;
};

describe('formatCustodyPlace', () => {
  it('joins location and bin, tolerating missing parts', () => {
    expect(formatCustodyPlace('Main Office', 'Shelf B3')).toBe('Main Office / Shelf B3');
    expect(formatCustodyPlace('Main Office', null)).toBe('Main Office');
    expect(formatCustodyPlace(null, '  ')).toBeNull();
  });
});

describe('isFollowUpOverdue', () => {
  it('compares calendar dates as strings', () => {
    expect(isFollowUpOverdue('2026-10-23', '2026-10-24')).toBe(true);
    expect(isFollowUpOverdue('2026-10-24', '2026-10-24')).toBe(false);
    expect(isFollowUpOverdue(null, '2026-10-24')).toBe(false);
  });
});

describe('daysHeldSince', () => {
  it('counts whole days and never goes negative', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    expect(daysHeldSince('2026-10-21T13:00:00Z', now)).toBe(2);
    expect(daysHeldSince('2026-10-25T00:00:00Z', now)).toBe(0);
  });
});

describe('describeCustodyHistory', () => {
  it('ignores non-custody entries', () => {
    expect(describeCustodyHistory({ change_type: 'updated', changes: {} }, t)).toBeNull();
  });

  it('words a move with both positions', () => {
    const d = describeCustodyHistory(
      {
        change_type: 'custody_moved',
        changes: {
          from_location_name: 'Main Office',
          from_bin: 'Shelf B3',
          to_location_name: 'Main Office',
          to_bin: 'Shelf C1',
          ticket_number: 'T-1042',
        },
      },
      t
    );
    expect(d?.title).toBe('Moved from Main Office / Shelf B3 to Main Office / Shelf C1');
    expect(d?.detail).toBe('Ticket T-1042');
  });

  it('distinguishes first intake from receive-back', () => {
    const intake = describeCustodyHistory(
      { change_type: 'custody_received', changes: { to_location_name: 'Main Office', to_bin: 'B3', purpose: 'repair' } },
      t
    );
    expect(intake?.title).toBe('Received into custody at Main Office / B3');
    expect(intake?.detail).toBe('repair');
    const back = describeCustodyHistory(
      {
        change_type: 'custody_received',
        changes: { from_location_id: null, from_holder_user_id: null, to_location_name: 'Main Office' },
      },
      t
    );
    expect(back?.title).toBe('Received back at Main Office');
  });

  it('words hand-off, shipping and return', () => {
    expect(
      describeCustodyHistory(
        { change_type: 'custody_handed_off', changes: { from_holder_name: 'Dana', to_holder_name: 'Sam' } },
        t
      )?.title
    ).toBe('Handed off from Dana to Sam');
    expect(
      describeCustodyHistory({ change_type: 'custody_shipped', changes: { counterparty: 'Dell RMA' } }, t)?.title
    ).toBe('Shipped to Dell RMA');
    expect(describeCustodyHistory({ change_type: 'custody_returned', changes: {} }, t)?.title).toBe('Returned to client');
  });

  it('lists the changed fields for custody_updated without exposing values', () => {
    const d = describeCustodyHistory(
      {
        change_type: 'custody_updated',
        changes: { fields: { follow_up_on: { before: '2026-10-25', after: '2026-10-30' }, next_action_note: { before: '[text]', after: '[text]' } } },
      },
      t
    );
    expect(d?.title).toBe('Custody details updated');
    expect(d?.detail).toBe('next action note, follow up on');
  });
});

describe('custodyEventToHistoryEntry', () => {
  it('preserves the photos on their custody event', async () => {
    const { custodyEventToHistoryEntry } = await import('./custodyDisplay');
    expect(custodyEventToHistoryEntry({ event_type: 'received', document_ids: ['photo-1', 'photo-2'] }).documentIds)
      .toEqual(['photo-1', 'photo-2']);
    expect(custodyEventToHistoryEntry({ event_type: 'moved' }).documentIds).toEqual([]);
  });
  it('feeds the same sentences as history rows', async () => {
    const { custodyEventToHistoryEntry } = await import('./custodyDisplay');
    const moved = custodyEventToHistoryEntry({
      event_type: 'moved',
      from_location_name: 'Main Office',
      from_bin: 'Shelf B3',
      to_location_name: 'Main Office',
      to_bin: 'Shelf C1',
    });
    expect(describeCustodyHistory(moved, t)?.title).toBe('Moved from Main Office / Shelf B3 to Main Office / Shelf C1');
    const back = custodyEventToHistoryEntry({ event_type: 'received', to_location_name: 'Main Office' }, true);
    expect(describeCustodyHistory(back, t)?.title).toBe('Received back at Main Office');
  });
});
