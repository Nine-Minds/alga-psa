import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type SlaActionError = ActionMessageError | ActionPermissionError;

export function slaActionErrorMessage(error: SlaActionError): string {
  return 'permissionError' in error ? error.permissionError : error.actionError;
}

export function isSlaActionError(value: unknown): value is SlaActionError {
  return slaActionErrorFrom(value) !== null;
}

export function slaPermissionError(action: string): ActionPermissionError {
  return permissionError(`Permission denied: You don't have permission to ${action}`);
}

export function slaActionErrorFrom(error: unknown): SlaActionError | null {
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
    if (message.startsWith('SLA policy target')) {
      return actionError('SLA policy target not found. It may have been deleted. Please refresh and try again.');
    }
    if (message.startsWith('SLA policy')) {
      return actionError('SLA policy not found. It may have been deleted. Please refresh and try again.');
    }
    if (message.startsWith('Priority')) {
      return actionError('Selected priority not found. It may have been deleted. Please refresh and try again.');
    }
    if (message.startsWith('Client')) {
      return actionError('Selected client not found. It may have been deleted. Please refresh and try again.');
    }
    if (message.startsWith('Board')) {
      return actionError('Selected board not found. It may have been deleted. Please refresh and try again.');
    }
    if (message.startsWith('Ticket')) {
      return actionError('Ticket not found. It may have been deleted. Please refresh and try again.');
    }
    if (message === 'A target for this priority already exists in this policy') {
      return actionError('A target for this priority already exists in this policy.');
    }
    if (message === 'SLA pause configuration requires a board-owned ticket status') {
      return actionError('SLA pause configuration requires a board-owned ticket status.');
    }
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected SLA values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required SLA field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected SLA record or related value no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This SLA change conflicts with an existing record. Please refresh and try again.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the SLA values is not allowed. Please review the form and try again.');
  }

  return null;
}
