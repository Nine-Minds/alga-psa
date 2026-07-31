import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type BoardActionError = ActionMessageError | ActionPermissionError;

const EXPECTED_BOARD_MESSAGES = [
  'Board not found',
  'Select a source board that has ticket statuses to copy',
  'Ticket status names are required.',
  'Add at least one ticket status before saving the board.',
  'Ticket status names must be unique within a board.',
  'Select exactly one open default ticket status before saving the board.',
  'Ticket status not found on the selected board.',
  'Ticket statuses cannot be moved or replaced implicitly.',
  'Ticket statuses cannot be moved across boards implicitly.',
  'Board ticket status actions only support ticket statuses.',
  'Invalid required fields:',
  'Inactivity days must be a positive whole number',
  'Warning lead time must be a positive whole number smaller than the inactivity days',
  'Trigger status not found on this board',
  'Trigger status must be an open status',
  'Target status not found on this board',
  'Target status must be a closed status',
  'An auto-close rule for this status already exists on this board',
  'Auto-close rule not found',
];

export function boardActionErrorFrom(error: unknown): BoardActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (EXPECTED_BOARD_MESSAGES.some((message) => error.message.startsWith(message))) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected board, status, or rule is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required board field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected board, status, priority, assignee, team, or SLA policy is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    if (dbError.constraint?.includes('board') && dbError.constraint?.includes('name')) {
      return actionError('A board with this name already exists.');
    }
    return actionError('A board or status with the same settings already exists.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the board or status values is invalid. Please refresh and try again.');
  }

  return null;
}
