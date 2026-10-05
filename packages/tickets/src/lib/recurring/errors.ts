export type RecurringTicketErrorCode =
  | 'DEFINITION_NOT_FOUND'
  | 'DEFINITION_ARCHIVED'
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_ALREADY_ADDED'
  | 'INVALID_REFERENCES';

/** Expected, user-safe failures of the recurring-ticket actions. */
export class RecurringTicketError extends Error {
  constructor(
    message: string,
    readonly code: RecurringTicketErrorCode,
    readonly params?: Record<string, string | number>
  ) {
    super(message);
    this.name = 'RecurringTicketError';
  }
}
