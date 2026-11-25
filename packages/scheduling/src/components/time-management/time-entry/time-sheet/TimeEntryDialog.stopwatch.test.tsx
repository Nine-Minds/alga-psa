// @vitest-environment jsdom
/**
 * The stopwatch drawer: a session within one day stays a single ordinary entry; a session that ran
 * across several work days renders one dated form per day, a total, Remove, and one atomic Save.
 * Validation problems show inline on the failing form: no window.alert, no field-error toast, and
 * nothing is sent.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => {
  const t = (key: string, options?: string | Record<string, any>) => {
    if (typeof options === 'string') return options;
    const template = options?.defaultValue ?? key;
    return template.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) => String(options?.[name] ?? ''));
  };
  return {
    t,
    fetchServicesForTimeEntry: vi.fn(),
    fetchTaxRegions: vi.fn(),
    getClientIdForWorkItem: vi.fn(),
    saveTimeEntry: vi.fn(),
    logStopwatchSession: vi.fn(),
    toast: {
      loading: vi.fn(() => 'loading-toast'),
      dismiss: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('../../../../actions/timeEntryActions', () => ({
  isServiceOptionalForWorkItem: vi.fn(async () => false),
  fetchServicesForTimeEntry: (...args: unknown[]) => mocks.fetchServicesForTimeEntry(...args),
  fetchTaxRegions: (...args: unknown[]) => mocks.fetchTaxRegions(...args),
  fetchClientTaxRateForWorkItem: vi.fn(async () => null),
  fetchScheduleEntryForWorkItem: vi.fn(async () => null),
  resolveDefaultTicketTimeEntryService: vi.fn(async () => null),
  deleteTimeEntry: vi.fn(),
  fetchTimeEntriesForTimeSheet: vi.fn(async () => []),
  fetchOrCreateTimeSheet: vi.fn(async () => ({ id: 'sheet-1' })),
  saveTimeEntry: (...args: unknown[]) => mocks.saveTimeEntry(...args),
  logStopwatchSession: (...args: unknown[]) => mocks.logStopwatchSession(...args),
}));

vi.mock('../../../../lib/contractLineDisambiguation', () => ({
  getClientIdForWorkItem: (...args: unknown[]) => mocks.getClientIdForWorkItem(...args),
}));

vi.mock('../../../../actions/clientInteractionLookupActions', () => ({
  getSchedulingClientById: vi.fn(async () => null),
}));

vi.mock('../../../../context/SchedulingCrossFeatureContext', () => ({
  useSchedulingCrossFeatureOptional: () => undefined,
}));

vi.mock('react-hot-toast', () => ({ toast: mocks.toast, default: mocks.toast }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.t }),
  useFormatters: () => ({
    locale: 'en',
    dateFormat: { dateOrder: 'mdy', timeFormat: '12h' },
    formatDate: (value: Date | string) => new Date(value).toISOString().slice(0, 10),
  }),
  translate: (_namespace: string, _key: string, options?: any) => {
    const template = options?.defaultValue ?? _key;
    return template.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(options?.[name] ?? ''));
  },
}));

// The real form's pickers are not what is under test; the stub renders the props the dialog hands
// down (index, errors, showErrors) so what the dialog passes to each day is observable.
vi.mock('./SingleTimeEntryForm', () => ({
  default: (props: any) => (
    <div data-testid={`entry-form-${props.index ?? 0}`}>
      <span data-testid={`entry-start-${props.index ?? 0}`}>{props.entry.start_time}</span>
      <button
        type="button"
        data-testid={`cross-midnight-${props.index ?? 0}`}
        onClick={() =>
          props.onUpdateEntry(props.index ?? 0, {
            ...props.entry,
            // 15h after a 10:00Z start: 01:00Z on the next day.
            end_time: new Date(Date.parse(props.entry.start_time) + 15 * 3_600_000).toISOString(),
            isDirty: true,
          })
        }
      />
      <button
        type="button"
        data-testid={`extend-${props.index ?? 0}`}
        onClick={() =>
          props.onUpdateEntry(props.index ?? 0, {
            ...props.entry,
            end_time: new Date(Date.parse(props.entry.end_time) + 30 * 60_000).toISOString(),
            isDirty: true,
          })
        }
      />
      {props.showErrors && props.errors?.startTime && <span data-testid={`start-error-${props.index ?? 0}`}>{props.errors.startTime}</span>}
      {props.showErrors && props.errors?.endTime && <span data-testid={`end-error-${props.index ?? 0}`}>{props.errors.endTime}</span>}
      {props.showErrors && props.errors?.duration && <span data-testid={`duration-error-${props.index ?? 0}`}>{props.errors.duration}</span>}
      {props.showErrors && props.errors?.date && <span data-testid={`date-error-${props.index ?? 0}`}>{props.errors.date}</span>}
    </div>
  ),
}));

import TimeEntryDialog from './TimeEntryDialog';
import { createTimeEntrySaveHandler } from '../../../../lib/timeEntrySaveAdapter';

const date = new Date('2026-09-01T10:00:00.000Z');
const threeDays = [
  { start: new Date('2026-09-01T10:00:00.000Z'), end: new Date('2026-09-01T10:30:00.000Z') },
  { start: new Date('2026-09-02T10:00:00.000Z'), end: new Date('2026-09-02T11:00:00.000Z') },
  { start: new Date('2026-09-03T10:00:00.000Z'), end: new Date('2026-09-03T11:30:00.000Z') },
];
const oneDay = [threeDays[0]];

const workItem = {
  work_item_id: 'task-1',
  type: 'project_task' as const,
  name: 'Build feature',
  description: '',
  service_id: 'service-1',
  service_name: 'Implementation',
  is_billable: true,
};

function renderDialog(plan: typeof threeDays, handler = createTimeEntrySaveHandler(undefined, async () => 'sheet-1', { stopwatchSessionId: 'session-1' })) {
  const onClose = vi.fn();
  render(
    <TimeEntryDialog
      isOpen={true}
      onClose={onClose}
      onSave={handler}
      onSaveAll={handler}
      workItem={workItem as any}
      date={date}
      isEditable={true}
      defaultStartTime={plan[0].start}
      defaultEndTime={plan[0].end}
      defaultEntries={plan}
      inDrawer={true}
      workTimeZone="UTC"
    />,
  );
  return { onClose };
}

describe('TimeEntryDialog with a stopwatch plan', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  function prime() {
    mocks.fetchServicesForTimeEntry.mockResolvedValue([{ id: 'service-1', name: 'Implementation', billing_method: 'hourly' }]);
    mocks.fetchTaxRegions.mockResolvedValue([]);
    mocks.getClientIdForWorkItem.mockResolvedValue(null);
    mocks.saveTimeEntry.mockResolvedValue({ entry_id: 'entry-1' });
    mocks.logStopwatchSession.mockResolvedValue([{ entry_id: 'a' }, { entry_id: 'b' }, { entry_id: 'c' }]);
  }

  it('a single-day session stays one ordinary entry: one form, no multi-day notice, one saveTimeEntry', async () => {
    prime();
    const { onClose } = renderDialog(oneDay);
    await screen.findByTestId('entry-form-0');

    expect(screen.queryByTestId('entry-form-1')).toBeNull();
    expect(screen.queryByText(/ran across/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.saveTimeEntry).toHaveBeenCalledTimes(1);
    expect(mocks.saveTimeEntry.mock.calls[0][0].stopwatch_session_id).toBe('session-1');
    expect(mocks.logStopwatchSession).not.toHaveBeenCalled();
  });

  it('a three-day session shows three dated forms, the notice and the total, and saves once atomically', async () => {
    prime();
    const { onClose } = renderDialog(threeDays);
    await screen.findByTestId('entry-form-2');

    expect(screen.getByTestId('entry-form-0')).toBeInTheDocument();
    expect(screen.getByTestId('entry-form-1')).toBeInTheDocument();
    expect(screen.getByText(/This timer ran across 3 days/)).toBeInTheDocument();
    expect(screen.getByText('Day 2 of 3 · 2026-09-02')).toBeInTheDocument();
    // 30 + 60 + 90 minutes
    expect(screen.getByText(/Total: .*3.*h/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    expect(mocks.logStopwatchSession).toHaveBeenCalledTimes(1);
    const [sessionId, entries] = mocks.logStopwatchSession.mock.calls[0];
    expect(sessionId).toBe('session-1');
    expect(entries).toHaveLength(3);
    expect(entries.map((e: any) => e.start_time.slice(0, 10))).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    // A sheet is resolved for each entry.
    expect(entries.every((e: any) => e.time_sheet_id === 'sheet-1')).toBe(true);
    expect(mocks.saveTimeEntry).not.toHaveBeenCalled();
  });

  it('the footer total follows an edited day, not only the planned spans', async () => {
    prime();
    renderDialog(threeDays);
    await screen.findByTestId('entry-form-2');
    expect(screen.getByText('Total: 3h 0m')).toBeInTheDocument();

    // Day 1 grows from 30 to 60 minutes: 60 + 60 + 90.
    fireEvent.click(screen.getByTestId('extend-0'));
    await waitFor(() => expect(screen.getByText('Total: 3h 30m')).toBeInTheDocument());
  });

  it('an entry edited across midnight shows inline errors and sends nothing: no alert, no toast', async () => {
    prime();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const { onClose } = renderDialog(threeDays);
    await screen.findByTestId('entry-form-2');

    fireEvent.click(screen.getByTestId('cross-midnight-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Day 2 now runs 10:00Z -> 01:00Z the next day.
    await waitFor(() => expect(screen.getByTestId('end-error-1')).toBeInTheDocument());
    expect(screen.getByTestId('duration-error-1')).toBeInTheDocument();
    // Untouched days stay clean.
    expect(screen.queryByTestId('end-error-0')).toBeNull();
    expect(screen.queryByTestId('end-error-2')).toBeNull();

    expect(mocks.logStopwatchSession).not.toHaveBeenCalled();
    expect(mocks.saveTimeEntry).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a single entry edited across midnight is also refused inline', async () => {
    prime();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    renderDialog(oneDay);
    await screen.findByTestId('entry-form-0');

    fireEvent.click(screen.getByTestId('cross-midnight-0'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByTestId('end-error-0')).toBeInTheDocument());
    expect(mocks.saveTimeEntry).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it('Remove drops a day and its time; the last remaining day cannot be removed', async () => {
    prime();
    renderDialog(threeDays);
    await screen.findByTestId('entry-form-2');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
    await waitFor(() => expect(screen.queryByTestId('entry-form-2')).toBeNull());
    expect(screen.getByTestId('entry-start-0')).toHaveTextContent('2026-09-01');
    expect(screen.getByTestId('entry-start-1')).toHaveTextContent('2026-09-03');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    await waitFor(() => expect(screen.queryByTestId('entry-form-1')).toBeNull());
    expect(screen.getByTestId('entry-start-0')).toHaveTextContent('2026-09-03');
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();

    mocks.logStopwatchSession.mockResolvedValue([{ entry_id: 'a' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.logStopwatchSession).toHaveBeenCalledTimes(1));
    expect(mocks.logStopwatchSession.mock.calls[0][1]).toHaveLength(1);
  });

  it('a server rejection is the only thing that toasts', async () => {
    prime();
    mocks.logStopwatchSession.mockResolvedValue({ actionError: 'The time sheet for 2026-09-02 is Approved.' });
    renderDialog(threeDays);
    await screen.findByTestId('entry-form-2');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('The time sheet for 2026-09-02 is Approved.'));
  });
});
