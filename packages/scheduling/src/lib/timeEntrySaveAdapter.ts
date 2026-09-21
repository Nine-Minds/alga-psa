import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ITimeEntry } from '@alga-psa/types';
import { saveTimeEntry } from '../actions/timeEntryActions';

/**
 * Adapter between the entry dialog's save contract and the save action.
 *
 * The dialog only reports success and closes when `onSave` fulfils, so a
 * returned action error (locked sheet, stale status, validation) must become a
 * rejection or the UI would dismiss the user's work as saved. Shared by the
 * period picker and the anchored existing-entry launcher so both paths behave
 * identically.
 */
export const createTimeEntrySaveHandler =
  (onComplete?: () => void) =>
  async (timeEntry: Omit<ITimeEntry, 'tenant'>): Promise<void> => {
    const savedEntry = await saveTimeEntry(timeEntry);
    if (isActionMessageError(savedEntry) || isActionPermissionError(savedEntry)) {
      throw new Error(getErrorMessage(savedEntry));
    }
    if (onComplete) {
      onComplete();
    }
  };
