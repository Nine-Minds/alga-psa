// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  contractLineFieldsForWrite,
  clampDurationToSameDay,
  getSameDayDurationLimit,
  getTimeEntryWorkDate,
  isTimeEntryOnWorkDate,
  getTimeEntryValidationErrors,
} from './utils';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('time entry same-day duration helpers', () => {
  it('calculates the maximum duration through 23:59 on the start day', () => {
    const start = new Date(2026, 3, 23, 8, 0, 0, 0);

    expect(getSameDayDurationLimit(start)).toBe(959);
  });

  it('clamps very large durations to the latest same-day end time', () => {
    const start = new Date(2026, 3, 23, 8, 0, 0, 0);
    const result = clampDurationToSameDay(start, Number.POSITIVE_INFINITY);

    expect(result.durationMinutes).toBe(959);
    expect(result.wasClampedToSameDay).toBe(true);
    expect(result.endTime.getFullYear()).toBe(2026);
    expect(result.endTime.getMonth()).toBe(3);
    expect(result.endTime.getDate()).toBe(23);
    expect(result.endTime.getHours()).toBe(23);
    expect(result.endTime.getMinutes()).toBe(59);
  });

  it('keeps valid same-day durations unchanged', () => {
    const start = new Date(2026, 3, 23, 8, 0, 0, 0);
    const result = clampDurationToSameDay(start, 90);

    expect(result.durationMinutes).toBe(90);
    expect(result.wasClampedToSameDay).toBe(false);
    expect(result.endTime.getHours()).toBe(9);
    expect(result.endTime.getMinutes()).toBe(30);
  });

  it('returns no valid duration when the start time is already the latest same-day end minute', () => {
    const start = new Date(2026, 3, 23, 23, 59, 0, 0);
    const result = clampDurationToSameDay(start, 60);

    expect(result.durationMinutes).toBe(0);
    expect(result.wasClampedToSameDay).toBe(true);
    expect(result.endTime.getHours()).toBe(23);
    expect(result.endTime.getMinutes()).toBe(59);
  });

  describe('getTimeEntryValidationErrors', () => {
    const alertMock = vi.fn();
    const stubAlert = () => {
      alertMock.mockClear();
      vi.spyOn(window, 'alert').mockImplementation(alertMock);
    };

    it('returns no errors for a valid same-day span', () => {
      stubAlert();
      expect(getTimeEntryValidationErrors({
        start_time: '2026-04-23T13:00:00.000Z',
        end_time: '2026-04-23T14:30:00.000Z',
        billable_duration: 90,
      }, 'UTC')).toEqual({});
      expect(alertMock).not.toHaveBeenCalled();
    });

    it('flags start >= end on start and end without alerting', () => {
      stubAlert();
      const errors = getTimeEntryValidationErrors({
        start_time: '2026-04-23T14:00:00.000Z',
        end_time: '2026-04-23T14:00:00.000Z',
        billable_duration: 0,
      }, 'UTC');
      expect(errors.startTime).toBe('Start time must be earlier than end time');
      expect(errors.endTime).toBe('End time must be later than start time');
      expect(errors.duration).toBe('Duration must be at least 1 minute');
      expect(alertMock).not.toHaveBeenCalled();
    });

    it('flags a span that crosses midnight in the subject zone', () => {
      stubAlert();
      // 22:00 -> 01:00 in New York, which is a single UTC day (02:00Z -> 05:00Z on the 24th).
      const crossing = {
        start_time: '2026-04-24T02:00:00.000Z',
        end_time: '2026-04-24T05:00:00.000Z',
        billable_duration: 180,
      };
      const errors = getTimeEntryValidationErrors(crossing, 'America/New_York');
      expect(errors.endTime).toBe('End time must be on the same day as start time');
      expect(errors.duration).toBe('Duration must end on the same day');
      // Same instants are one day in UTC.
      expect(getTimeEntryValidationErrors(crossing, 'UTC')).toEqual({});
      expect(alertMock).not.toHaveBeenCalled();
    });

    it('falls back to browser-local days without a zone', () => {
      stubAlert();
      const errors = getTimeEntryValidationErrors({
        start_time: new Date(2026, 3, 23, 23, 0, 0, 0).toISOString(),
        end_time: new Date(2026, 3, 24, 0, 30, 0, 0).toISOString(),
        billable_duration: 90,
      });
      expect(errors.endTime).toBeTruthy();
      expect(alertMock).not.toHaveBeenCalled();
    });

    it('flags billable minutes above the duration', () => {
      stubAlert();
      const errors = getTimeEntryValidationErrors({
        start_time: '2026-04-23T13:00:00.000Z',
        end_time: '2026-04-23T14:00:00.000Z',
        billable_duration: 90,
      }, 'UTC');
      expect(errors.duration).toBe('Billable duration cannot exceed total duration');
      expect(errors.startTime).toBeUndefined();
      expect(alertMock).not.toHaveBeenCalled();
    });

    it('skips the billable check when no billable duration is given and flags unparsable times', () => {
      stubAlert();
      expect(getTimeEntryValidationErrors({
        start_time: '2026-04-23T13:00:00.000Z',
        end_time: '2026-04-23T14:00:00.000Z',
      }, 'UTC')).toEqual({});
      expect(getTimeEntryValidationErrors({ start_time: 'nope', end_time: 'nah' }, 'UTC').duration).toBe('Enter a valid time range');
      expect(alertMock).not.toHaveBeenCalled();
    });
  });

  it('T003: prefers work_date for timezone-boundary display grouping', () => {
    const entry = {
      work_date: '2026-03-31',
      start_time: '2026-04-01T00:00:00.000Z',
    } as any;

    expect(getTimeEntryWorkDate(entry)).toBe('2026-03-31');
    expect(isTimeEntryOnWorkDate(entry, '2026-03-31')).toBe(true);
    expect(isTimeEntryOnWorkDate(entry, '2026-04-01')).toBe(false);
  });

  it('normalizes serialized work_date values without falling back to start_time', () => {
    expect(getTimeEntryWorkDate({
      work_date: '2026-03-31T00:00:00.000Z',
      start_time: '2026-04-01T00:00:00.000Z',
    })).toBe('2026-03-31');

    expect(getTimeEntryWorkDate({
      work_date: new Date('2026-03-31T00:00:00.000Z'),
      start_time: '2026-04-01T00:00:00.000Z',
    })).toBe('2026-03-31');
  });

  it('T008: fails fast when work_date is missing after migration', () => {
    const entry = {
      entry_id: 'entry-without-work-date',
      work_date: null,
      start_time: '2026-04-01T00:00:00.000Z',
    } as any;

    expect(() => getTimeEntryWorkDate(entry)).toThrow('entry-without-work-date');
    expect(() => isTimeEntryOnWorkDate(entry, '2026-04-01')).toThrow('entry-without-work-date');
  });
});

describe('contractLineFieldsForWrite', () => {
  it('re-save omits server-resolved lines but keeps explicit and legacy ones', () => {
    expect(contractLineFieldsForWrite({ contract_line_id: 'l', contract_line_source: 'auto_unique_service' }, 'resave'))
      .toEqual({ contract_line_id: null, contract_line_source: undefined });
    expect(contractLineFieldsForWrite({ contract_line_id: 'l', contract_line_source: 'explicit' }, 'resave'))
      .toEqual({ contract_line_id: 'l' });
    expect(contractLineFieldsForWrite({ contract_line_id: 'l' }, 'resave')).toEqual({ contract_line_id: 'l' });
  });

  it('re-save keeps an explicit null (un-picked line) as null so the column is cleared', () => {
    const fields = contractLineFieldsForWrite({ contract_line_id: null, contract_line_source: undefined }, 'resave');
    expect(fields.contract_line_id).toBeNull();
    expect(contractLineFieldsForWrite({ contract_line_id: null, contract_line_source: 'unresolved' }, 'resave').contract_line_id)
      .toBeNull();
    // no value at all stays undefined
    expect(contractLineFieldsForWrite({}, 'resave').contract_line_id).toBeUndefined();
  });

  it('copy-to-new-entry carries only explicit lines', () => {
    expect(contractLineFieldsForWrite({ contract_line_id: 'l', contract_line_source: 'explicit' }, 'copy-to-new-entry'))
      .toEqual({ contract_line_id: 'l' });
    for (const contract_line_source of ['auto_bucket_overlay', 'unresolved', undefined]) {
      expect(contractLineFieldsForWrite({ contract_line_id: 'l', contract_line_source }, 'copy-to-new-entry').contract_line_id)
        .toBeUndefined();
    }
  });
});
