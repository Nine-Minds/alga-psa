import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { IUserWithRoles } from '@alga-psa/types';

export type ProjectBillingActionError = ActionMessageError | ActionPermissionError;
export type ProjectBillingActionResult<T> = T | ProjectBillingActionError;

export function isProjectBillingActionError(value: unknown): value is ProjectBillingActionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function validationMessage(error: unknown): string | null {
  const issues = (error as { issues?: Array<{ message?: unknown }> })?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const messages = issues
    .map((issue) => issue.message)
    .filter((message): message is string => typeof message === 'string' && message.length > 0);
  return messages.length > 0 ? messages.join('; ') : null;
}

export function projectBillingActionErrorFrom(error: unknown): ProjectBillingActionError | null {
  if (isProjectBillingActionError(error)) return error;

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected project billing values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required project billing field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected project, invoice, phase, service, or billing record no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A conflicting project billing record already exists. Please refresh and try again.');
  }
  if (dbError?.code === '23514') {
    return actionError('The project billing values violate a data rule. Review the form and try again.');
  }

  const invalid = validationMessage(error);
  if (invalid) return actionError(invalid);

  if (!(error instanceof Error)) return null;
  if (
    error.message.includes('Permission denied') ||
    error.message.includes('Access denied') ||
    error.message.includes('not authenticated')
  ) {
    return permissionError(error.message);
  }

  const safeBusinessPrefixes = [
    'A ',
    'Approve ',
    'Billing ',
    'Cannot ',
    'Client ',
    'Exactly ',
    'Fixed-price ',
    'Illegal ',
    'Invoiced ',
    'Manual ',
    'Nothing ',
    'Only ',
    'One ',
    'Project ',
    'Rate ',
    'Schedule ',
    'Selected ',
    'The ',
    'Unable ',
    'phase_id ',
    'trigger_date ',
  ];
  return safeBusinessPrefixes.some((prefix) => error.message.startsWith(prefix))
    ? actionError(error.message)
    : null;
}

export function withProjectBillingActionErrors<TArgs extends unknown[], TResult>(
  handler: (
    user: IUserWithRoles,
    context: { tenant: string },
    ...args: TArgs
  ) => Promise<TResult>,
): (
  user: IUserWithRoles,
  context: { tenant: string },
  ...args: TArgs
) => Promise<ProjectBillingActionResult<TResult>> {
  return async (
    user: IUserWithRoles,
    context: { tenant: string },
    ...args: TArgs
  ): Promise<ProjectBillingActionResult<TResult>> => {
    try {
      return await handler(user, context, ...args);
    } catch (error) {
      const expected = projectBillingActionErrorFrom(error);
      if (expected) return expected;
      console.error('[project-billing] Unexpected action failure', error);
      return actionError('Project billing could not complete the request. Please refresh and try again.');
    }
  };
}
