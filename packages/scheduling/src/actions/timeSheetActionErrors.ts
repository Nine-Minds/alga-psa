import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  bucketUsageErrorMessage,
  findBucketUsageError,
} from '@alga-psa/shared/billingClients/bucketUsageErrors';

export type TimeSheetActionError = ActionMessageError | ActionPermissionError;

export function timeSheetActionErrorFrom(error: unknown): TimeSheetActionError | null {
  // Check the typed bucket failure first: it carries which of several unrelated
  // causes fired, so it can say something the user can act on. The string match
  // further down is the fallback for any throw not yet converted.
  const bucketError = findBucketUsageError(error);
  if (bucketError) {
    return actionError(bucketUsageErrorMessage(bucketError));
  }

  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('Permission denied:')) {
      return permissionError(message);
    }
    if (message.includes('Time sheet not found') || message.includes('Time sheet with id')) {
      return actionError('Time sheet not found. It may have been deleted. Please refresh and try again.');
    }
    if (message.includes('not in a submitted state')) {
      return actionError('Only submitted time sheets can be approved.');
    }
    if (message.includes('Time sheet ID is required')) {
      return actionError('Time sheet ID is required.');
    }
    if (message.includes('Ticket ID is required')) {
      return actionError('Ticket ID is required.');
    }
    if (message.includes('Failed to delete work item')) {
      return actionError('Unable to remove that work item. Please refresh and try again.');
    }
    if (
      message.includes('Time entry not found') ||
      message.includes('Original time entry with ID') ||
      message.includes('not found for update')
    ) {
      return actionError('Time entry not found. It may have been deleted. Please refresh and try again.');
    }
    if (message.includes('Service is required for time entries')) {
      return actionError('Select a service before saving this time entry.');
    }
    if (message.includes('already been invoiced')) {
      return actionError('This time entry has already been invoiced and cannot be changed.');
    }
    if (message.includes('Unknown work item type')) {
      return actionError('The selected work item type is not supported for time entries.');
    }
    if (message.includes('Failed to update bucket usage') || message.includes('Bucket usage update failed')) {
      return actionError('Unable to update bucket usage for this time entry. Please refresh and try again.');
    }
    if (message.includes('Time sheet is not in an approved state')) {
      return actionError('Only approved time sheets can be reopened.');
    }
    if (message.includes('contains invoiced time')) {
      return actionError('This time sheet contains invoiced time and cannot be reopened.');
    }
    if (message.includes('Time entry user does not match time sheet owner')) {
      return actionError('This time entry does not belong to the selected time sheet.');
    }
    if (message.includes('Time entry must fall within the time period for the time sheet')) {
      return actionError('Time entry must fall within the selected time sheet period.');
    }
    if (message.includes('Only draft time sheets can be removed')) {
      return actionError('Only draft time sheets can be removed.');
    }
    if (message.includes('Time sheet still has time entries')) {
      return actionError('Remove time entries before removing this time sheet.');
    }
    if (message.includes('Validation failed')) {
      return actionError(message.replace(/^Validation failed:\s*/, ''));
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected time entry, time sheet, or work item is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required time sheet or time entry field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected time sheet, time entry, work item, or user is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A conflicting time entry already exists. Please refresh and try again.');
  }

  return null;
}
