import {
  actionError,
  isAuthorizationThrow,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type SlaActionError = ActionMessageError | ActionPermissionError;

export function slaActionErrorMessage(error: unknown): string {
  const candidate = error as { permissionError?: unknown; actionError?: unknown };
  return typeof candidate.permissionError === 'string' ? candidate.permissionError : String(candidate.actionError ?? 'Action failed');
}

export function isSlaActionError(value: unknown): value is SlaActionError {
  return slaActionErrorFrom(value) !== null;
}

export type SlaPermissionAction = 'view' | 'create' | 'update' | 'delete';

const SLA_PERMISSION_DESCRIPTIONS: Record<SlaPermissionAction, string> = {
  view: 'view SLA policies',
  create: 'create SLA policies',
  update: 'update SLA policies',
  delete: 'delete SLA policies',
};

// A frame plus an English action does not translate, so each action names its own
// whole sentence.
const SLA_PERMISSION_KEYS: Record<SlaPermissionAction, string> = {
  view: 'msp/settings:errors.sla.permissions.view',
  create: 'msp/settings:errors.sla.permissions.create',
  update: 'msp/settings:errors.sla.permissions.update',
  delete: 'msp/settings:errors.sla.permissions.delete',
};

export function slaPermissionError(action: SlaPermissionAction): ActionPermissionError {
  return permissionError(
    `Permission denied: You don't have permission to ${SLA_PERMISSION_DESCRIPTIONS[action]}`,
    SLA_PERMISSION_KEYS[action],
  );
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
    if (isAuthorizationThrow(error)) {
      return permissionError(message);
    }
    if (message.startsWith('SLA policy target')) {
      return actionError('SLA policy target not found. It may have been deleted. Please refresh and try again.', 'msp/settings:errors.sla.targetNotFound');
    }
    if (message.startsWith('SLA policy')) {
      return actionError('SLA policy not found. It may have been deleted. Please refresh and try again.', 'msp/settings:errors.sla.policyNotFound');
    }
    if (message.startsWith('Priority')) {
      return actionError('Selected priority not found. It may have been deleted. Please refresh and try again.', 'msp/settings:errors.sla.priorityNotFound');
    }
    if (message.startsWith('Client')) {
      return actionError('Selected client not found. It may have been deleted. Please refresh and try again.', 'msp/settings:errors.sla.clientNotFound');
    }
    if (message.startsWith('Board')) {
      return actionError('Selected board not found. It may have been deleted. Please refresh and try again.', 'msp/settings:errors.sla.boardNotFound');
    }
    if (message.startsWith('Ticket')) {
      return actionError('Ticket not found. It may have been deleted. Please refresh and try again.', 'msp/settings:errors.sla.ticketNotFound');
    }
    if (message === 'A target for this priority already exists in this policy') {
      return actionError('A target for this priority already exists in this policy.', 'msp/settings:errors.sla.duplicateTarget');
    }
    if (message === 'SLA pause configuration requires a board-owned ticket status') {
      return actionError('SLA pause configuration requires a board-owned ticket status.', 'msp/settings:errors.sla.pauseRequiresBoardStatus');
    }
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected SLA values is invalid. Please refresh and try again.', 'msp/settings:errors.sla.invalidValue');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required SLA field: ${dbError.column}.`,
          'msp/settings:errors.sla.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required SLA field.', 'msp/settings:errors.sla.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected SLA record or related value no longer exists. Please refresh and try again.', 'msp/settings:errors.sla.referenceMissing');
  }
  if (dbError?.code === '23505') {
    return actionError('This SLA change conflicts with an existing record. Please refresh and try again.', 'msp/settings:errors.sla.conflict');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the SLA values is not allowed. Please review the form and try again.', 'msp/settings:errors.sla.notAllowed');
  }

  return null;
}
