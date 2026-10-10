import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export type ContractWizardActionError = ActionMessageError | ActionPermissionError;

/**
 * Returned (not thrown) when rebuilding an existing draft would change its
 * server-computed monthly recurring value and the submission did not
 * acknowledge that exact baseline. The transaction has been rolled back.
 */
export type RecurringTotalChangeConfirmation = {
  confirmation_required: 'recurring_total_change';
  baseline_monthly_cents: number;
  resulting_monthly_cents: number;
};

export function isRecurringChangeConfirmation(value: unknown): value is RecurringTotalChangeConfirmation {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { confirmation_required?: unknown }).confirmation_required === 'recurring_total_change'
  );
}

/** Thrown inside the finalize transaction to roll it back; mapped to {@link RecurringTotalChangeConfirmation}. */
export class RecurringTotalChangeRequiresConfirmation extends Error {
  constructor(
    readonly baselineMonthlyCents: number,
    readonly resultingMonthlyCents: number,
  ) {
    super('Rebuilding this draft changes its monthly recurring value');
    this.name = 'RecurringTotalChangeRequiresConfirmation';
  }
}

export const FIXED_LINE_NO_SERVICE_PREFIX = 'Fixed line "';

export function fixedLineNoServiceMessage(lineName: string): string {
  return `Fixed line "${lineName}" has a recurring amount but no service to bill it on — add a service before finishing`;
}

export function contractWizardActionErrorFrom(error: unknown): ContractWizardActionError | null {
  if (!(error instanceof Error)) return null;

  if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
    return permissionError(error.message);
  }

  if (error.message.startsWith(FIXED_LINE_NO_SERVICE_PREFIX) && error.message.includes('has a recurring amount but no service')) {
    const match = /^Fixed line "(.*)" has a recurring amount/.exec(error.message);
    return actionError(error.message, 'msp/contracts:errors.wizard.fixedLineNoService', { lineName: match?.[1] ?? '' });
  }

  if (
    error.message === 'Submit either fixed_lines or the legacy fixed_services/fixed_base_rate fields, not both' ||
    error.message.startsWith('Catalog item "') ||
    error.message.startsWith('Product "') ||
    error.message.startsWith('Cannot create contract in') ||
    error.message.includes('Mixed-currency contracts for the same client are not supported') ||
    error.message === 'Contract start date is required' ||
    error.message === 'Draft contract not found' ||
    error.message === 'Only draft contracts can be updated via the wizard' ||
    error.message === 'Template not found' ||
    error.message === 'Contract not found' ||
    error.message === 'Contract is not a draft' ||
    error.message === 'Draft contract is missing client assignment' ||
    error.message === 'Draft contract has an invalid start date'
  ) {
    return actionError(error.message);
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected contract wizard records is no longer valid. Please refresh and try again.', 'msp/contracts:errors.wizard.recordInvalid');
  }
  if (dbError?.code === '23505') {
    return actionError('A matching contract wizard record already exists.', 'msp/contracts:errors.wizard.duplicate');
  }

  return null;
}
