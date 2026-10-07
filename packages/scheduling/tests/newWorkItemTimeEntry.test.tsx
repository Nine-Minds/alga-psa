// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  fetchOrCreateTimeSheet: vi.fn(),
  saveTimeEntry: vi.fn(),
  dialogProps: [] as any[],
}));

vi.mock('../src/actions/timeEntryActions', () => ({
  fetchOrCreateTimeSheet: (...args: unknown[]) => mocks.fetchOrCreateTimeSheet(...args),
  saveTimeEntry: (...args: unknown[]) => mocks.saveTimeEntry(...args),
}));

const interpolate = (_key: string, options?: string | Record<string, any>) => {
  if (typeof options === 'string') return options;
  const template = options?.defaultValue ?? _key;
  return template.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) => String(options?.[name] ?? ''));
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: interpolate }),
  translate: (_namespace: string, key: string, options?: Record<string, any>) => interpolate(key, options),
  useFormatters: () => ({
    formatDate: (value: Date | string) => {
      const date = new Date(value);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    },
  }),
}));

vi.mock('../src/components/time-management/time-entry/time-sheet/TimeEntryDialog', () => ({
  default: (props: any) => {
    mocks.dialogProps.push(props);
    return <div data-testid="time-entry-dialog-stub">{props.notice}</div>;
  },
}));

import NewWorkItemTimeEntry from '../src/components/time-management/time-entry/time-sheet/NewWorkItemTimeEntry';
import { resolveEntryDefaults } from '../src/lib/timeEntryPeriodSelection';
import { TimeEntrySaveRejectedError } from '../src/lib/timeEntrySaveAdapter';

const ZONE = 'America/New_York';

function period(period_id: string, start_date: string, end_date: string, timeSheetStatus: string) {
  return { period_id, start_date, end_date, timeSheetStatus, timeSheetId: null, hoursEntered: 0, daysLogged: 0, tenant: 't' } as any;
}

const periods = [
  period('sep-07', '2026-09-07', '2026-09-14', 'DRAFT'),
  period('aug-17', '2026-08-17', '2026-08-24', 'SUBMITTED'),
  period('aug-10', '2026-08-10', '2026-08-17', 'DRAFT'),
];

const NOW = new Date('2026-09-09T15:00:00Z');

function renderEntry(overrides: { periods?: any[]; now?: Date; onComplete?: () => void } = {}) {
  const catalog = overrides.periods ?? periods;
  const defaults = resolveEntryDefaults({ context: {}, periods: catalog, timeZone: ZONE, now: overrides.now ?? NOW })!;
  const onComplete = overrides.onComplete ?? vi.fn();
  render(
    <NewWorkItemTimeEntry
      closeDrawer={vi.fn()}
      onComplete={onComplete}
      workItem={{ work_item_id: 'ticket-1', type: 'ticket', name: 'Ticket 1', description: '' } as any}
      userId="user-1"
      userTimeZone={ZONE}
      periods={catalog}
      defaults={defaults}
    />,
  );
  return { props: mocks.dialogProps[mocks.dialogProps.length - 1], onComplete };
}

// 10:00 in New York on the given day.
const entryOn = (day: string) => ({
  work_item_id: 'ticket-1',
  work_item_type: 'ticket',
  start_time: `${day}T14:00:00.000Z`,
  end_time: `${day}T15:00:00.000Z`,
  service_id: 'svc-1',
}) as any;

describe('NewWorkItemTimeEntry', () => {
  beforeEach(() => {
    mocks.dialogProps.length = 0;
    mocks.fetchOrCreateTimeSheet.mockReset();
    mocks.saveTimeEntry.mockReset();
  });
  afterEach(() => cleanup());

  it('opens the entry form directly against the whole catalog, with no sheet fixed or created', () => {
    const { props } = renderEntry();
    expect(props.periodCatalog).toBe(periods);
    expect(props.timePeriod).toBeUndefined();
    expect(props.timeSheetId).toBeUndefined();
    expect(props.workTimeZone).toBe(ZONE);
    expect(props.defaultStartTime.toISOString()).toBe('2026-09-09T12:00:00.000Z');
    expect(props.notice).toBeUndefined();
    expect(mocks.fetchOrCreateTimeSheet).not.toHaveBeenCalled();
  });

  it('explains when today’s sheet is locked and the default moved', () => {
    const locked = periods.map((p) => (p.period_id === 'sep-07' ? { ...p, timeSheetStatus: 'APPROVED' } : p));
    const { props } = renderEntry({ periods: locked });
    expect(props.notice).toBe(
      'Today’s time sheet is Approved, so the entry starts on 2026-08-16, the nearest day that can take time.',
    );
  });

  it('explains when no period covers today', () => {
    const { props } = renderEntry({ now: new Date('2026-09-20T15:00:00Z') });
    expect(props.notice).toBe(
      'No time period covers today, so the entry starts on 2026-09-13, the nearest day that can take time.',
    );
  });

  it('resolves the sheet from the entry date at save and saves against it once', async () => {
    mocks.fetchOrCreateTimeSheet.mockResolvedValue({ id: 'sheet-aug-10', approval_status: 'DRAFT' });
    mocks.saveTimeEntry.mockResolvedValue({ entry_id: 'entry-1' });
    const { props, onComplete } = renderEntry();

    await props.onSave(entryOn('2026-08-11'));

    expect(mocks.fetchOrCreateTimeSheet).toHaveBeenCalledWith('user-1', 'aug-10');
    expect(mocks.saveTimeEntry).toHaveBeenCalledTimes(1);
    expect(mocks.saveTimeEntry.mock.calls[0][0]).toMatchObject({ time_sheet_id: 'sheet-aug-10', start_time: '2026-08-11T14:00:00.000Z' });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('derives the work date in the subject timezone, not UTC', async () => {
    mocks.fetchOrCreateTimeSheet.mockResolvedValue({ id: 'sheet-aug-10', approval_status: 'DRAFT' });
    mocks.saveTimeEntry.mockResolvedValue({ entry_id: 'entry-1' });
    const { props } = renderEntry();

    // 02:00 UTC on Aug 17 is still Aug 16 in New York: the Aug 10 sheet, not the submitted one.
    await props.onSave({ ...entryOn('2026-08-16'), start_time: '2026-08-17T02:00:00.000Z', end_time: '2026-08-17T03:00:00.000Z' });

    expect(mocks.fetchOrCreateTimeSheet).toHaveBeenCalledWith('user-1', 'aug-10');
  });

  it('rejects with the sheet’s status when it was submitted after the form opened', async () => {
    mocks.fetchOrCreateTimeSheet.mockResolvedValue({ id: 'sheet-aug-10', approval_status: 'SUBMITTED' });
    const { props, onComplete } = renderEntry();

    const result = props.onSave(entryOn('2026-08-11'));
    await expect(result).rejects.toBeInstanceOf(TimeEntrySaveRejectedError);
    await expect(result).rejects.toThrow(
      'The time sheet for 2026-08-11 is Submitted. Pick a day on a draft sheet or one with changes requested.',
    );
    expect(mocks.saveTimeEntry).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('rejects a day no period covers without creating a sheet', async () => {
    const { props } = renderEntry();

    await expect(props.onSave(entryOn('2026-08-30'))).rejects.toThrow(
      'No time period covers 2026-08-30. Pick a day inside a time period.',
    );
    expect(mocks.fetchOrCreateTimeSheet).not.toHaveBeenCalled();
    expect(mocks.saveTimeEntry).not.toHaveBeenCalled();
  });

  it('turns a returned save error, such as the server lock, into a readable rejection', async () => {
    mocks.fetchOrCreateTimeSheet.mockResolvedValue({ id: 'sheet-aug-10', approval_status: 'DRAFT' });
    mocks.saveTimeEntry.mockResolvedValue({
      actionError: 'This time sheet is locked. Choose a draft sheet or a sheet with changes requested.',
    });
    const { props, onComplete } = renderEntry();

    const result = props.onSave(entryOn('2026-08-11'));
    await expect(result).rejects.toBeInstanceOf(TimeEntrySaveRejectedError);
    await expect(result).rejects.toThrow('This time sheet is locked.');
    expect(onComplete).not.toHaveBeenCalled();
  });
});
