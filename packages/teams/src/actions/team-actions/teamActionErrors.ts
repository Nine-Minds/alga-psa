import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type TeamActionError = ActionMessageError | ActionPermissionError;

export function teamActionErrorMessage(error: TeamActionError): string {
  return 'permissionError' in error ? error.permissionError : error.actionError;
}

export function isTeamActionError(value: unknown): value is TeamActionError {
  return teamActionErrorFrom(value) !== null;
}

export function teamActionErrorFrom(error: unknown): TeamActionError | null {
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
    if (message.includes('Team not found')) {
      return actionError('Team not found. It may have been deleted. Please refresh and try again.');
    }
    if (message.includes('manager_id is required') || message.includes('A team must have a manager')) {
      return actionError('A team must have a team lead. Select a team lead and try again.');
    }
    if (message.includes('Cannot add inactive users to team') || message.includes('Cannot add inactive user to team')) {
      return actionError('Inactive users cannot be added to a team.');
    }
    if (message.includes('Cannot remove the team lead')) {
      return actionError('Cannot remove the team lead. Please assign a new team lead first.');
    }
  }

  const dbError = error as { code?: string; constraint?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected team values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This user is already a member of the team.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required team field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected team lead or member is no longer valid. Please refresh and try again.');
  }

  return null;
}
