import { actionError, type ActionMessageError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { ticketActionErrorFrom } from './ticketActionErrors';

export type TicketTemplateActionError = ActionMessageError | ActionPermissionError;

/** Thrown for failures the editor can show verbatim. */
export class TicketTemplateError extends Error {
  constructor(
    message: string,
    readonly code: 'TEMPLATE_NOT_FOUND' | 'DUPLICATE_NAME' | 'INVALID_REFERENCES' | 'NOT_AVAILABLE' | 'IN_USE_BY_SCHEDULES',
    readonly params?: Record<string, string | number>
  ) {
    super(message);
    this.name = 'TicketTemplateError';
  }
}

const ERROR_KEYS: Record<TicketTemplateError['code'], string> = {
  TEMPLATE_NOT_FOUND: 'features/tickets:templates.errors.notFound',
  DUPLICATE_NAME: 'features/tickets:templates.errors.duplicateName',
  INVALID_REFERENCES: 'features/tickets:templates.errors.invalidReferences',
  NOT_AVAILABLE: 'features/tickets:templates.errors.notAvailable',
  IN_USE_BY_SCHEDULES: 'features/tickets:templates.errors.inUseBySchedules',
};

const UNIQUE_NAME_INDEX = 'ticket_templates_active_name_unique';

/** Citus appends `_<shardid>` to constraint/index names raised from shard execution. */
function baseConstraintName(constraint: string | undefined): string | undefined {
  return constraint?.replace(/_\d+$/, '');
}

export function isDuplicateTemplateNameViolation(error: unknown): boolean {
  const dbError = error as { code?: string; constraint?: string };
  return dbError?.code === '23505' && baseConstraintName(dbError.constraint) === UNIQUE_NAME_INDEX;
}

export function ticketTemplateActionErrorFrom(error: unknown): TicketTemplateActionError | null {
  if (error instanceof TicketTemplateError) {
    return actionError(error.message, ERROR_KEYS[error.code], error.params);
  }
  return ticketActionErrorFrom(error);
}
