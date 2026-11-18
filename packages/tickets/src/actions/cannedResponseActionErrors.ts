import { actionError, type ActionMessageError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { ticketActionErrorFrom } from './ticketActionErrors';

export type CannedResponseActionError = ActionMessageError | ActionPermissionError;

/** Thrown for failures the editor can show verbatim. */
export class CannedResponseError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'DUPLICATE_NAME' | 'INVALID_REFERENCES' | 'NOT_AVAILABLE' | 'NOT_A_TEAM_MEMBER',
    readonly params?: Record<string, string | number>
  ) {
    super(message);
    this.name = 'CannedResponseError';
  }
}

const ERROR_KEYS: Record<CannedResponseError['code'], string> = {
  NOT_FOUND: 'features/tickets:cannedResponses.errors.notFound',
  DUPLICATE_NAME: 'features/tickets:cannedResponses.errors.duplicateName',
  INVALID_REFERENCES: 'features/tickets:cannedResponses.errors.invalidReferences',
  NOT_AVAILABLE: 'features/tickets:cannedResponses.errors.notAvailable',
  NOT_A_TEAM_MEMBER: 'features/tickets:cannedResponses.errors.notATeamMember',
};

const UNIQUE_NAME_INDEX = 'canned_responses_active_name_unique';

/** Citus appends `_<shardid>` to constraint/index names raised from shard execution. */
function baseConstraintName(constraint: string | undefined): string | undefined {
  return constraint?.replace(/_\d+$/, '');
}

export function isDuplicateCannedResponseNameViolation(error: unknown): boolean {
  const dbError = error as { code?: string; constraint?: string };
  return dbError?.code === '23505' && baseConstraintName(dbError.constraint) === UNIQUE_NAME_INDEX;
}

export function cannedResponseActionErrorFrom(error: unknown): CannedResponseActionError | null {
  if (error instanceof CannedResponseError) {
    return actionError(error.message, ERROR_KEYS[error.code], error.params);
  }
  return ticketActionErrorFrom(error);
}
