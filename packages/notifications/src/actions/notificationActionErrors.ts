import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type NotificationActionError = ActionMessageError | ActionPermissionError;

export function isNotificationActionError(value: unknown): value is NotificationActionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

export function notificationActionErrorFrom(error: unknown): NotificationActionError | null {
  if (isNotificationActionError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message;
    if (message.startsWith('Permission denied') || message === 'user is not logged in') {
      return permissionError(message);
    }
    if (message === 'System template not found') {
      return actionError('System template not found. It may have been deleted. Please refresh and try again.');
    }
    if (/^Template '.+' not found$/.test(message)) {
      return actionError('Notification template not found. It may have been deleted. Please refresh and try again.');
    }
    if (message === 'Category not found') {
      return actionError('Notification category not found. It may have been deleted. Please refresh and try again.');
    }
    if (message === 'Subtype not found') {
      return actionError('Notification subtype not found. It may have been deleted. Please refresh and try again.');
    }
    if (message === 'Notification not found') {
      return actionError('Notification not found. It may have already been updated or deleted.');
    }
    if (message.startsWith('Cannot disable ')) {
      return actionError(message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected notification records is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required notification field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected notification records no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A notification setting with these details already exists.');
  }

  return null;
}
