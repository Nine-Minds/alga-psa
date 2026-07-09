'use server';

import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type TicketActionError = ActionMessageError | ActionPermissionError;

const EXPECTED_TICKET_MESSAGE_PREFIXES = [
  'Client user cannot access this ticket',
  'Client user is not associated with a client',
  'Client users can only create their own comments',
  'Client users cannot create internal comments',
  'Bundle settings not found',
  'Cannot add children to a bundled child ticket',
  'Cannot select a child ticket as the master',
  'Cannot unbundle from a child ticket id',
  'Comment with id',
  'Changing the board requires selecting a status for the destination board',
  'Child ticket not found',
  'Invalid category combination',
  'Invalid destination status',
  'Invalid location',
  'Invalid status',
  'Master ticket cannot also be a child ticket',
  'Master ticket not found',
  'New master ticket must be a child of the current master',
  'New master ticket must be different from the current master',
  'New master ticket not found',
  'No child tickets provided',
  'No default ticket status configured for the selected board',
  'Only MSP users can create internal comments',
  'Only MSP users can set comments as internal',
  'Old master ticket is not a master',
  'Old master ticket not found',
  'One or more selected tickets were bundled concurrently',
  'Parent comment must belong to the same ticket',
  'Parent comment not found',
  'Promoted ticket already has children of its own',
  'Resource already exists',
  'Cannot reply to a deleted comment',
  'Reply visibility must match the thread root visibility',
  'Select at least one child ticket different from the master',
  'Status not valid for this board',
  'Tenant required',
  'Tenant is required to delete comment',
  'Tenant is required to update comment',
  'Team lead not found',
  'Team not found',
  'This comment is system-generated and cannot be deleted.',
  'This comment is system-generated and cannot be edited.',
  'Ticket is already bundled',
  'Ticket is not bundled',
  'Ticket cannot be closed',
  'Ticket status does not belong to the selected board',
  'Ticket not found',
  'Ticket resource not found',
  'This ticket is bundled',
  'You can only edit your own comments',
  'limit must be a positive integer',
  'selected status does not belong to the selected board',
  'ticket_id is required for client comments',
  'ticketId required',
];

function formatValidationIssues(error: unknown): string | null {
  const issues = (error as { issues?: Array<{ path?: Array<string | number>; message?: string }> })?.issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    return null;
  }

  return issues
    .map((issue) => {
      const field = issue.path?.join('.');
      return field ? `${field}: ${issue.message || 'Invalid value'}` : issue.message || 'Invalid value';
    })
    .join('; ');
}

export function ticketActionErrorFrom(error: unknown): TicketActionError | null {
  if (error instanceof Error) {
    if (error.message.includes('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }

    if (error.message.startsWith('Ticket not found')) {
      return actionError('Ticket not found. It may have been deleted or moved. Please refresh and try again.');
    }
    if (error.message.startsWith('Ticket resource not found')) {
      return actionError('Ticket resource not found. Please refresh and try again.');
    }
    if (error.message.startsWith('Resource already exists')) {
      return actionError('This user is already assigned as an additional agent.');
    }
    if (error.message.startsWith('Team not found')) {
      return actionError('Team not found. It may have been deleted. Please refresh and try again.');
    }
    if (error.message.startsWith('Team lead not found')) {
      return actionError('The selected team does not have a team lead. Choose another team or assign a lead first.');
    }
    if (error.message.startsWith('Comment with id')) {
      return actionError('Comment not found. It may have been deleted. Please refresh and try again.');
    }

    if (EXPECTED_TICKET_MESSAGE_PREFIXES.some((message) => error.message.startsWith(message))) {
      return actionError(error.message);
    }
  }

  const validationMessage = formatValidationIssues(error);
  if (validationMessage) {
    return actionError(`Please fix the ticket details: ${validationMessage}`);
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected ticket values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required ticket field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected ticket records no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This ticket change conflicts with an existing record. Please refresh and try again.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the ticket values is not allowed. Please review the form and try again.');
  }

  return null;
}
