import {
  actionError,
  actionErrorFromValidationIssue,
  errorCodeOf,
  isAuthorizationThrow,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type TicketActionError = ActionMessageError | ActionPermissionError;

/**
 * Codes a ticket action can throw with (`new CodedError(msg, 'TICKET_NOT_FOUND')`).
 * Classification reads these first; the English prefix list below is the fallback for
 * the throw sites that still say what went wrong only in a sentence.
 */
export type TicketErrorCode =
  | 'TICKET_NOT_FOUND'
  | 'TICKET_RESOURCE_NOT_FOUND'
  | 'RESOURCE_ALREADY_EXISTS'
  | 'TEAM_NOT_FOUND'
  | 'TEAM_LEAD_NOT_FOUND'
  | 'COMMENT_NOT_FOUND';

const TICKET_CODE_MESSAGES: Record<TicketErrorCode, string> = {
  TICKET_NOT_FOUND: 'Ticket not found. It may have been deleted or moved. Please refresh and try again.',
  TICKET_RESOURCE_NOT_FOUND: 'Ticket resource not found. Please refresh and try again.',
  RESOURCE_ALREADY_EXISTS: 'This user is already assigned as an additional agent.',
  TEAM_NOT_FOUND: 'Team not found. It may have been deleted. Please refresh and try again.',
  TEAM_LEAD_NOT_FOUND: 'The selected team does not have a team lead. Choose another team or assign a lead first.',
  COMMENT_NOT_FOUND: 'Comment not found. It may have been deleted. Please refresh and try again.',
};

const TICKET_CODE_MESSAGE_KEYS: Record<TicketErrorCode, string> = {
  TICKET_NOT_FOUND: 'features/tickets:errors.action.ticketNotFound',
  TICKET_RESOURCE_NOT_FOUND: 'features/tickets:errors.action.ticketResourceNotFound',
  RESOURCE_ALREADY_EXISTS: 'features/tickets:errors.action.agentAlreadyAssigned',
  TEAM_NOT_FOUND: 'features/tickets:errors.action.teamNotFound',
  TEAM_LEAD_NOT_FOUND: 'features/tickets:errors.action.teamLeadNotFound',
  COMMENT_NOT_FOUND: 'features/tickets:errors.action.commentNotFound',
};

/** Read by callers that need to tell "not found" apart after the message is localized. */
export const TICKET_NOT_FOUND_MESSAGE_KEY = TICKET_CODE_MESSAGE_KEYS.TICKET_NOT_FOUND;

/**
 * DEPRECATED fallback channel. Every entry is the message of an internal
 * `throw new Error(...)` that is safe to show a user, matched by prefix.
 *
 * The prose is only safe because it is *thrown*, and thrown messages never cross the
 * localization boundary — `localizeActionError` rewrites returned payloads. Do not
 * translate a message at any of these throw sites: put the key on the returned
 * `actionError` instead. New throw sites should carry a `TicketErrorCode` so this list
 * can shrink rather than grow.
 */
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

// Longest prefix first, so 'Team lead not found' is not swallowed by 'Team not found'.
const TICKET_MESSAGE_PREFIX_CODES: ReadonlyArray<readonly [string, TicketErrorCode]> = [
  ['Ticket resource not found', 'TICKET_RESOURCE_NOT_FOUND'],
  ['Resource already exists', 'RESOURCE_ALREADY_EXISTS'],
  ['Team lead not found', 'TEAM_LEAD_NOT_FOUND'],
  ['Comment with id', 'COMMENT_NOT_FOUND'],
  ['Ticket not found', 'TICKET_NOT_FOUND'],
  ['Team not found', 'TEAM_NOT_FOUND'],
];

function ticketErrorCodeOf(error: unknown): TicketErrorCode | undefined {
  const code = errorCodeOf(error);
  if (code && code in TICKET_CODE_MESSAGES) {
    return code as TicketErrorCode;
  }

  // Fallback for throw sites that only say what happened in English.
  if (error instanceof Error) {
    return TICKET_MESSAGE_PREFIX_CODES.find(([prefix]) => error.message.startsWith(prefix))?.[1];
  }

  return undefined;
}

export function ticketActionErrorFrom(error: unknown): TicketActionError | null {
  if (isAuthorizationThrow(error)) {
    return permissionError(error instanceof Error ? error.message : String(error));
  }

  const ticketCode = ticketErrorCodeOf(error);
  if (ticketCode) {
    return actionError(TICKET_CODE_MESSAGES[ticketCode], TICKET_CODE_MESSAGE_KEYS[ticketCode]);
  }

  if (error instanceof Error) {
    if (EXPECTED_TICKET_MESSAGE_PREFIXES.some((message) => error.message.startsWith(message))) {
      return actionError(error.message);
    }
  }

  const firstIssue = (error as { issues?: unknown[] })?.issues?.[0];
  if (firstIssue && typeof firstIssue === 'object') {
    return actionErrorFromValidationIssue(firstIssue);
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected ticket values is invalid. Please refresh and try again.', 'features/tickets:errors.ticket.invalidValue');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required ticket field: ${dbError.column}.`,
          'features/tickets:errors.ticket.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required ticket field.', 'features/tickets:errors.ticket.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected ticket records no longer exists. Please refresh and try again.', 'features/tickets:errors.ticket.referenceMissing');
  }
  if (dbError?.code === '23505') {
    return actionError('This ticket change conflicts with an existing record. Please refresh and try again.', 'features/tickets:errors.ticket.conflict');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the ticket values is not allowed. Please review the form and try again.', 'features/tickets:errors.ticket.valueNotAllowed');
  }

  return null;
}
