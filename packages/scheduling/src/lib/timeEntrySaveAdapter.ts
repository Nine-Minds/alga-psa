import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { translate } from '@alga-psa/ui/lib/i18n/client';
import type { ITimeEntry } from '@alga-psa/types';
import { fetchOrCreateTimeSheet, saveTimeEntry } from '../actions/timeEntryActions';
import {
  isEditableSheetStatus,
  periodForWorkDate,
  workDateInTimeZone,
  type CatalogPeriod,
} from './timeEntryPeriodSelection';

/**
 * A save the server or the sheet resolver refused for a reason the user can act
 * on (locked sheet, no period, validation). The dialog shows its message as-is
 * instead of the generic failure copy.
 */
export class TimeEntrySaveRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeEntrySaveRejectedError';
  }
}

type SaveableEntry = Omit<ITimeEntry, 'tenant'>;

/** Picks the sheet an entry belongs to at save time; returns its id or throws a rejection. */
export type TimeSheetResolver = (timeEntry: SaveableEntry) => Promise<string>;

const STATUS_FALLBACKS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes Requested',
};

/** Localized label for a sheet status; shared by the form hint and save rejections. */
export function sheetStatusLabel(status: string | null | undefined): string {
  const key = status && STATUS_FALLBACKS[status] ? status : 'UNKNOWN';
  return translate('msp/time-entry', `workItemEntry.sheetStatus.${key}`, {
    defaultValue: STATUS_FALLBACKS[key] ?? 'Unknown',
  });
}

/**
 * Resolve the subject user's sheet from the entry's work date, derived in the
 * same timezone the server uses for work_date. The sheet is fetched or created
 * only here, at Save, so opening and cancelling the form leaves nothing behind.
 * The server repeats the period and status checks under a row lock; this pass
 * exists to give a precise reason before the write is attempted.
 */
export function createCatalogSheetResolver(params: {
  userId: string;
  periods: readonly CatalogPeriod[];
  timeZone: string;
  /** Renders a YYYY-MM-DD work date for messages; defaults to the raw date. */
  formatWorkDate?: (workDate: string) => string;
}): TimeSheetResolver {
  const { userId, periods, timeZone, formatWorkDate = (workDate: string) => workDate } = params;
  return async (timeEntry) => {
    const workDate = workDateInTimeZone(timeEntry.start_time, timeZone);
    const period = periodForWorkDate(periods, workDate);
    if (!period) {
      throw new TimeEntrySaveRejectedError(
        translate('msp/time-entry', 'workItemEntry.save.noPeriod', {
          date: formatWorkDate(workDate),
          defaultValue: 'No time period covers {{date}}. Pick a day inside a time period.',
        }),
      );
    }

    const sheet = await fetchOrCreateTimeSheet(userId, period.period_id);
    if (isActionMessageError(sheet) || isActionPermissionError(sheet)) {
      throw new TimeEntrySaveRejectedError(getErrorMessage(sheet));
    }
    if (!isEditableSheetStatus(sheet.approval_status)) {
      throw new TimeEntrySaveRejectedError(
        translate('msp/time-entry', 'workItemEntry.save.sheetLocked', {
          date: formatWorkDate(workDate),
          status: sheetStatusLabel(sheet.approval_status),
          defaultValue:
            'The time sheet for {{date}} is {{status}}. Pick a day on a draft sheet or one with changes requested.',
        }),
      );
    }
    return sheet.id;
  };
}

/**
 * Adapter between the entry dialog's save contract and the save action.
 *
 * The dialog only reports success and closes when `onSave` fulfils, so a
 * returned action error (locked sheet, stale status, validation) must become a
 * rejection or the UI would dismiss the user's work as saved. Shared by the
 * new-entry and anchored existing-entry launchers so both paths behave
 * identically. When a resolver is given, it supplies the sheet from the
 * entry's date instead of a sheet fixed when the form opened.
 */
export const createTimeEntrySaveHandler =
  (onComplete?: () => void, resolveTimeSheetId?: TimeSheetResolver) =>
  async (timeEntry: SaveableEntry): Promise<void> => {
    const entryToSave = resolveTimeSheetId
      ? { ...timeEntry, time_sheet_id: await resolveTimeSheetId(timeEntry) }
      : timeEntry;
    const savedEntry = await saveTimeEntry(entryToSave);
    if (isActionMessageError(savedEntry) || isActionPermissionError(savedEntry)) {
      throw new TimeEntrySaveRejectedError(getErrorMessage(savedEntry));
    }
    if (onComplete) {
      onComplete();
    }
  };
