import { z } from 'zod';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type ReportingActionError = ActionMessageError | ActionPermissionError;

export function reportingActionErrorFrom(error: unknown): ReportingActionError | null {
  if (error && typeof error === 'object') {
    const candidate = error as { actionError?: unknown; permissionError?: unknown };
    if (typeof candidate.permissionError === 'string') {
      return permissionError(candidate.permissionError);
    }
    if (typeof candidate.actionError === 'string') {
      return actionError(candidate.actionError);
    }
  }

  if (error instanceof z.ZodError) {
    const first = error.errors[0];
    const field = first?.path.join('.');
    const message = first ? `${field ? `${field}: ` : ''}${first.message}` : 'Invalid report parameters.';
    return actionError(message);
  }

  if (error instanceof Error) {
    const message = error.message;
    if (
      message.includes('Permission denied') ||
      message.startsWith('Unauthorized') ||
      message === 'user is not logged in'
    ) {
      return permissionError(message);
    }
    if (message.startsWith('Validation Error:')) {
      return actionError(message.replace(/^Validation Error:\s*/, ''));
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected report records is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required report field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected report records no longer exists. Please refresh and try again.');
  }

  return null;
}
