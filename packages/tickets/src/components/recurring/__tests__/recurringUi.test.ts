import { describe, expect, it } from 'vitest';
import {
  calendarStringToDate,
  dateToCalendarString,
  describeOccurrenceReason,
  formatCalendarDate,
  formatInstant,
  isBlankDocument,
  overriddenGroups,
  permissionsFromChecks,
  recurringErrorMessage,
  unwrapRecurring,
} from '../recurringUi';

const id = '00000000-0000-4000-8000-000000000001';

describe('overriddenGroups', () => {
  it('is empty when the client inherits everything', () => {
    expect(overriddenGroups({})).toEqual([]);
  });

  it('lists the overridden groups in a stable order', () => {
    expect(overriddenGroups({
      assignment: { assigned_to: null, assigned_team_id: null, additional_agent_ids: [] },
      board: { board_id: id, status_id: null },
    })).toEqual(['board', 'assignment']);
  });
});

describe('permissionsFromChecks', () => {
  it('denies everything and reports not loaded before the check resolves', () => {
    expect(permissionsFromChecks(null)).toEqual({ read: false, create: false, update: false, delete: false, loaded: false });
  });

  it('maps each recurring_ticket action and ignores other resources', () => {
    const result = permissionsFromChecks([
      { resource: 'recurring_ticket', action: 'read', granted: true },
      { resource: 'recurring_ticket', action: 'create', granted: false },
      { resource: 'recurring_ticket', action: 'update', granted: true },
      { resource: 'ticket', action: 'delete', granted: true },
    ]);
    expect(result).toEqual({ read: true, create: false, update: true, delete: false, loaded: true });
  });
});

describe('recurringErrorMessage / unwrapRecurring', () => {
  it('recognises action and permission error payloads', () => {
    expect(recurringErrorMessage({ actionError: 'Nope' })).toBe('Nope');
    expect(recurringErrorMessage({ permissionError: 'Forbidden' })).toBe('Forbidden');
  });

  it('returns null for ordinary results and unwrap passes them through', () => {
    const value = [{ definition_id: id }];
    expect(recurringErrorMessage(value)).toBeNull();
    expect(unwrapRecurring(value)).toBe(value);
  });

  it('unwrap throws the message of an error payload', () => {
    expect(() => unwrapRecurring({ permissionError: 'Forbidden' })).toThrow('Forbidden');
  });
});

describe('describeOccurrenceReason', () => {
  const t = (key: string, defaultValue: string, options?: Record<string, unknown>) =>
    `${key}|${defaultValue}|${JSON.stringify(options ?? {})}`;

  it('is empty without a reason', () => {
    expect(describeOccurrenceReason(null, t)).toBe('');
  });

  it('localizes the client_inactive code', () => {
    expect(describeOccurrenceReason('client_inactive', t)).toContain('recurring.history.reasons.clientInactive');
  });

  it('localizes previous_open with the ticket number', () => {
    const text = describeOccurrenceReason('previous_open:T-0042', t);
    expect(text).toContain('recurring.history.reasons.previousOpen');
    expect(text).toContain('"number":"T-0042"');
  });

  it('shows free text as stored', () => {
    expect(describeOccurrenceReason('Board was deleted', t)).toBe('Board was deleted');
  });
});

describe('isBlankDocument', () => {
  it('treats null, empty and whitespace-only paragraphs as blank', () => {
    expect(isBlankDocument(null)).toBe(true);
    expect(isBlankDocument([])).toBe(true);
    expect(isBlankDocument([{ type: 'paragraph', content: [] }])).toBe(true);
    expect(isBlankDocument([{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }])).toBe(true);
  });

  it('is not blank with text or any non-paragraph block', () => {
    expect(isBlankDocument([{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }])).toBe(false);
    expect(isBlankDocument([{ type: 'heading', content: [] }])).toBe(false);
  });
});

describe('calendar date helpers', () => {
  it('round-trips a YYYY-MM-DD string without timezone drift', () => {
    expect(dateToCalendarString(calendarStringToDate('2026-03-08') as Date)).toBe('2026-03-08');
    expect(dateToCalendarString(calendarStringToDate('2026-12-31') as Date)).toBe('2026-12-31');
  });

  it('rejects malformed input', () => {
    expect(calendarStringToDate('08/03/2026')).toBeUndefined();
    expect(calendarStringToDate('')).toBeUndefined();
  });

  it('formats a calendar date as that same day regardless of the host timezone', () => {
    expect(formatCalendarDate('2026-03-08', 'en-US')).toBe('Mar 8, 2026');
    expect(formatCalendarDate(null, 'en-US')).toBe('');
  });
});

describe('formatInstant', () => {
  it('shows the instant in the tenant timezone', () => {
    expect(formatInstant('2026-01-15T14:30:00Z', 'en-US', 'America/New_York')).toContain('9:30');
    expect(formatInstant('2026-01-15T14:30:00Z', 'en-US', 'Europe/Berlin')).toContain('3:30');
    expect(formatInstant(null, 'en-US', 'UTC')).toBe('');
  });
});
