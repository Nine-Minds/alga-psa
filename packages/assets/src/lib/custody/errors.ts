export type CustodyErrorCode =
  | 'not_found'
  | 'asset_not_found'
  | 'ticket_not_found'
  | 'ticket_has_no_client'
  | 'client_mismatch'
  | 'open_episode_exists'
  | 'episode_closed'
  | 'invalid_transition'
  | 'location_inactive'
  | 'holder_invalid'
  | 'no_change'
  | 'invalid_date'
  | 'tag_generation_failed'
  | 'permission_denied';

/** A refusal the user should see verbatim. Everything else is a real failure. */
export class CustodyError extends Error {
  constructor(public readonly code: CustodyErrorCode, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'CustodyError';
  }
}

export function isCustodyError(error: unknown): error is CustodyError {
  return error instanceof CustodyError;
}
