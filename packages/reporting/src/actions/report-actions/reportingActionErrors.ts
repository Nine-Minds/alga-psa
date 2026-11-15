import { z } from 'zod';
import type { Knex } from 'knex';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';
import { resolveReportClientScope } from '../../lib/reports/clientScope/reportClientScope';
import {
  ClientScopeRefusedError,
  describeClientScopeRefusal,
  type ClientScopeRefusal,
} from '../../lib/reports/clientScope/refusal';
import { ReportClientScopeRefusedError } from '../../lib/reports/core/types';
import { REPORT_RANGE_PROBLEMS, ReportRangeError } from '../reportRange';
import {
  actionError,
  isAuthorizationThrow,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type ReportingActionError = ActionMessageError | ActionPermissionError;

/** A refusal to run a report for a client-restricted subject, as the catalogued action error the UI shows. */
export function clientScopeRefusalActionError(refusal: ClientScopeRefusal): ActionMessageError {
  const { message, key, params } = describeClientScopeRefusal(refusal);
  return actionError(message, key, params);
}

export function reportingActionErrorFrom(error: unknown): ReportingActionError | null {
  if (error instanceof ClientScopeRefusedError || error instanceof ReportClientScopeRefusedError) {
    return clientScopeRefusalActionError(error.refusal);
  }

  if (error instanceof ReportRangeError) {
    const { message, key, params } = REPORT_RANGE_PROBLEMS[error.problem];
    return actionError(message, `msp/reports:${key}`, params);
  }

  if (error && typeof error === 'object') {
    const candidate = error as { actionError?: unknown; permissionError?: unknown };
    if (typeof candidate.permissionError === 'string') {
      return permissionError(candidate.permissionError);
    }
    if (typeof candidate.actionError === 'string') {
      return actionError(candidate.actionError);
    }
  }

  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    const field = first?.path.join('.');
    const message = first ? `${field ? `${field}: ` : ''}${first.message}` : 'Invalid report parameters.';
    return actionError(message);
  }

  if (error instanceof Error) {
    const message = error.message;
    if (
      isAuthorizationThrow(error) ||
      message.startsWith('Unauthorized')
    ) {
      return permissionError(message);
    }
    if (message.startsWith('Validation Error:')) {
      return actionError(message.replace(/^Validation Error:\s*/, ''));
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected report records is invalid. Please refresh and try again.', 'msp/reports:errors.report.invalidValue');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required report field: ${dbError.column}.`,
          'msp/reports:errors.report.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required report field.', 'msp/reports:errors.report.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected report records no longer exists. Please refresh and try again.', 'msp/reports:errors.report.referenceMissing');
  }

  return null;
}

/**
 * For a report that takes a client id: a client-restricted internal user asking about a client outside their scope
 * is refused (the client portal has its own own-client check and is not narrowed here). Null when the client is in scope.
 * Unrestricted subjects cost the one cached tenant probe.
 */
export async function clientOutOfScopeError(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  clientId: string
): Promise<ReportingActionError | null> {
  if (user.user_type === 'client') return null;
  const scope = await resolveReportClientScope(conn, { tenant, user });
  if (await scope.permitsClient(conn, tenant, clientId)) return null;
  return permissionError('You do not have access to this client.', 'msp/reports:errors.report.clientOutOfScope');
}

/** A hand-written report that totals every client together: refused whenever the subject is client-restricted. */
export async function refuseWhenClientRestricted(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  reportId: string
): Promise<ReportingActionError | null> {
  const scope = await resolveReportClientScope(conn, { tenant, user });
  if (!scope.narrowed) return null;
  return clientScopeRefusalActionError({
    code: 'unnarrowable_report',
    reportId,
    reason: 'it totals the ledgers of every client together and has no per-row client limit',
  });
}
