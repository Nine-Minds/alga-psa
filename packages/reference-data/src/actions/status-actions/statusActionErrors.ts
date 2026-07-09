import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type StatusActionError = ActionMessageError | ActionPermissionError;

export function statusActionErrorMessage(error: unknown): string {
  const candidate = error as { permissionError?: unknown; actionError?: unknown };
  return typeof candidate.permissionError === 'string' ? candidate.permissionError : String(candidate.actionError ?? 'Action failed');
}

export function isStatusActionError(value: unknown): value is StatusActionError {
  return statusActionErrorFrom(value) !== null;
}

export function statusActionErrorFrom(error: unknown): StatusActionError | null {
  if (error && typeof error === 'object') {
    const candidate = error as { permissionError?: unknown; actionError?: unknown };
    if (typeof candidate.permissionError === 'string') {
      return permissionError(candidate.permissionError);
    }
    if (typeof candidate.actionError === 'string') {
      return actionError(candidate.actionError);
    }
  }

  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('Permission denied') || message === 'user is not logged in') {
      return permissionError(message);
    }
    if (message === 'Status not found') {
      return actionError('Status not found. It may have been deleted. Please refresh and try again.');
    }
    if (
      message === 'Status name is required' ||
      message === 'Status name cannot be empty' ||
      message === 'Status ID is required' ||
      message === 'A status with this name already exists' ||
      message === 'Ticket statuses must be managed from board settings'
    ) {
      return actionError(message);
    }
  }

  const dbError = error as { code?: string; constraint?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected status values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required status field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected related record for this status no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    if (dbError.constraint?.includes('order')) {
      return actionError('This order number is already in use. Please choose a different order number.');
    }
    return actionError('A status with this name already exists.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the status values is not allowed. Please review the form and try again.');
  }

  return null;
}
