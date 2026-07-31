import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type ClientPortalActionError = ActionMessageError | ActionPermissionError;

export function clientPortalActionErrorFrom(error: unknown): ClientPortalActionError | null {
  if (error && typeof error === 'object') {
    const candidate = error as { actionError?: unknown; permissionError?: unknown };
    if (typeof candidate.permissionError === 'string') {
      return permissionError(candidate.permissionError);
    }
    if (typeof candidate.actionError === 'string') {
      return actionError(candidate.actionError);
    }
  }

  if (error instanceof Error) {
    const message = error.message;
    if (
      message.startsWith('Unauthorized:') ||
      message.startsWith('Access denied:') ||
      message.startsWith('Insufficient permissions') ||
      message.startsWith('Permission denied:')
    ) {
      return permissionError(message);
    }

    if (
      message.includes('not found') ||
      message.includes('not accessible') ||
      message.includes('not associated') ||
      message.includes('is required') ||
      message.startsWith('Invalid ') ||
      message.startsWith('Validation Error:')
    ) {
      return actionError(message);
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected records is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected records no longer exists. Please refresh and try again.');
  }

  return null;
}
