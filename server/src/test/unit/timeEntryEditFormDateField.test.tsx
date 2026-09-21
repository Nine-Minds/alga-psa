/**
 * @vitest-environment jsdom
 *
 * Regression coverage for alga0002002: editing a saved time entry must expose a Date
 * field so the entry can be moved to another day, bounded to the entry's time period so
 * it stays in the same time sheet.
 *
 * The DatePicker is stubbed to capture the bounds the form computes — this keeps the test
 * focused on the form's logic (un-gating + the exclusive-end off-by-one) without depending
 * on react-day-picker's calendar DOM.
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WorkItemType } from '../../interfaces/workItem.interfaces';
import { TimeSheetStatus } from '../../interfaces/timeEntry.interfaces';
import TimeEntryEditForm from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryEditForm';

// Capture every set of props the (stubbed) DatePicker receives.
const datePickerSpy = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: (props: Record<string, unknown>) => {
    datePickerSpy.calls.push(props);
    return <div data-testid="time-entry-date-picker" />;
  }
}));

// The form resolves a client and loads eligible contract lines on mount; stub both so the
// effects stay inert and never touch a real DB.
vi.mock('@alga-psa/scheduling/lib/contractLineDisambiguation', () => ({
  getClientIdForWorkItem: vi.fn().mockResolvedValue(null),
  getEligibleContractLinesForUI: vi.fn().mockResolvedValue([])
}));

vi.mock('@alga-psa/scheduling/actions/clientInteractionLookupActions', () => ({
  getSchedulingClientById: vi.fn().mockResolvedValue(null)
}));

describe('TimeEntryEditForm date field (alga0002002)', () => {
  const baseEntry = {
    entry_id: 'entry-1',
    work_item_id: 'work-item-1',
    work_item_type: 'project_task' as WorkItemType,
    start_time: '2026-02-10T12:00:00.000Z',
    end_time: '2026-02-10T13:00:00.000Z',
    billable_duration: 60,
    notes: '',
    user_id: 'user-1',
    time_sheet_id: 'timesheet-1',
    approval_status: 'DRAFT' as TimeSheetStatus,
    service_id: 'service-1',
    created_at: '2026-02-10T12:00:00.000Z',
    updated_at: '2026-02-10T12:00:00.000Z',
    isNew: false,
    isDirty: false
  };

  // Half-open period [start, end): Feb 1 through Feb 15 inclusive; Feb 16 is the exclusive end.
  const timePeriod = {
    period_id: 'period-1',
    start_date: '2026-02-01',
    end_date: '2026-02-16'
  } as never;

  const services = [
    { id: 'service-1', name: 'Test Service', type: 'Time', tax_rate_id: null, tax_percentage: null }
  ];

  const noop = vi.fn();

  const renderForm = (overrides: Record<string, unknown> = {}) =>
    render(
      <TimeEntryEditForm
        id="form"
        entry={baseEntry}
        index={0}
        isEditable={true}
        services={services}
        taxRegions={[]}
        timeInputs={{}}
        totalDuration={60}
        onSave={noop}
        onDelete={noop}
        onUpdateEntry={noop}
        onUpdateTimeInputs={noop}
        isNewEntry={false}
        {...overrides}
      />
    );

  const lastDatePickerProps = () => datePickerSpy.calls[datePickerSpy.calls.length - 1];

  beforeEach(() => {
    datePickerSpy.calls.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  test('renders the Date field when editing a saved entry (not just new entries)', () => {
    renderForm({ isNewEntry: false, timePeriod });

    // The bug was that the date control was gated behind isNewEntry; on edit it must show.
    expect(screen.getByTestId('time-entry-date-picker')).toBeTruthy();
  });

  test('bounds the picker to the period, treating end_date as exclusive (maxDate = end_date - 1)', () => {
    renderForm({ isNewEntry: false, timePeriod });

    const { minDate, maxDate } = lastDatePickerProps() as { minDate: Date; maxDate: Date };

    // minDate is the inclusive period start (Feb 1, 2026), built as a local date.
    expect(minDate.getFullYear()).toBe(2026);
    expect(minDate.getMonth()).toBe(1); // February (0-indexed)
    expect(minDate.getDate()).toBe(1);

    // maxDate is the last day *inside* the half-open period: end_date (Feb 16) minus one day.
    expect(maxDate.getFullYear()).toBe(2026);
    expect(maxDate.getMonth()).toBe(1);
    expect(maxDate.getDate()).toBe(15);
  });

  test('leaves the picker unbounded when no time period is supplied', () => {
    renderForm({ isNewEntry: false, timePeriod: undefined });

    const { minDate, maxDate } = lastDatePickerProps() as { minDate?: Date; maxDate?: Date };
    expect(minDate).toBeUndefined();
    expect(maxDate).toBeUndefined();
  });

  // Regression: the launcher's default is 08:00 in the *subject* timezone. With
  // the browser in UTC and the subject in Pacific/Auckland, that instant is
  // 2026-08-09T20:00Z, whose browser-local day is Aug 9 — before the period's
  // Aug 10 minimum. The form must show the subject calendar day instead.
  describe('subject-timezone date alignment (browser UTC, subject Pacific/Auckland)', () => {
    const SUBJECT_TZ = 'Pacific/Auckland';
    const tzPeriod = {
      period_id: 'period-tz',
      start_date: '2026-08-10',
      end_date: '2026-08-17',
    } as never;

    const subjectDay = (value: string | Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: SUBJECT_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(typeof value === 'string' ? new Date(value) : value);

    // 08:00 on Aug 10 in Auckland, which is Aug 9 20:00 UTC.
    const aucklandDefaultEntry = {
      ...baseEntry,
      entry_id: null,
      start_time: '2026-08-09T20:00:00.000Z',
      end_time: '2026-08-09T21:00:00.000Z',
      isNew: true,
    };

    test('shows the subject calendar day for the default, inside the period bounds', () => {
      renderForm({
        entry: aucklandDefaultEntry,
        isNewEntry: true,
        timePeriod: tzPeriod,
        workTimeZone: SUBJECT_TZ,
      });

      const props = lastDatePickerProps() as { value: Date; minDate: Date; maxDate: Date };

      // The displayed day is the subject day (Aug 10), not the browser day (Aug 9).
      expect(subjectDay(props.value)).toBe('2026-08-10');
      expect(props.value.getFullYear()).toBe(2026);
      expect(props.value.getMonth()).toBe(7);
      expect(props.value.getDate()).toBe(10);

      // Bounds are the subject period days; the minimum is Aug 10, not Aug 9.
      expect(props.minDate.getDate()).toBe(10);
      expect(props.maxDate.getDate()).toBe(16);
      expect(subjectDay(props.value) >= '2026-08-10').toBe(true);
    });

    test('selecting the final permitted day keeps the saved subject work_date inside the period', () => {
      const onUpdateEntry = vi.fn();
      renderForm({
        entry: aucklandDefaultEntry,
        isNewEntry: true,
        timePeriod: tzPeriod,
        workTimeZone: SUBJECT_TZ,
        onUpdateEntry,
      });

      const props = lastDatePickerProps() as { minDate: Date; maxDate: Date };
      props.onChange?.(props.maxDate);

      expect(onUpdateEntry).toHaveBeenCalled();
      const updated = onUpdateEntry.mock.calls[onUpdateEntry.mock.calls.length - 1][1];
      const startDay = subjectDay(updated.start_time);
      const endDay = subjectDay(updated.end_time);

      // The server derives work_date from start_time in the subject timezone; it
      // must land on the final permitted day, not roll out of the period.
      expect(startDay).toBe('2026-08-16');
      expect(endDay).toBe('2026-08-16');
      expect(startDay >= '2026-08-10' && startDay < '2026-08-17').toBe(true);
    });
  });
});
