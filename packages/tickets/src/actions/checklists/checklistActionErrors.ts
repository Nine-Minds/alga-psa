import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type ChecklistActionError = ActionMessageError | ActionPermissionError;

const EXPECTED_CHECKLIST_MESSAGES = new Set([
  'Ticket not found',
  'Checklist item name is required',
  'Checklist item not found',
  'Template name is required',
  'Checklist template not found',
  'Item name is required',
  'Template item not found',
  'Apply rule not found',
]);

export function checklistActionErrorFrom(error: unknown): ChecklistActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (EXPECTED_CHECKLIST_MESSAGES.has(error.message)) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected checklist item, template, or rule is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required checklist field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected ticket, checklist template, or rule filter is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the checklist values is invalid. Please refresh and try again.');
  }

  return null;
}
