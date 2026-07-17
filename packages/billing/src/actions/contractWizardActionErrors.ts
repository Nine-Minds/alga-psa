import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export type ContractWizardActionError = ActionMessageError | ActionPermissionError;

export function contractWizardActionErrorFrom(error: unknown): ContractWizardActionError | null {
  if (!(error instanceof Error)) return null;

  if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
    return permissionError(error.message);
  }

  if (
    error.message.startsWith('Catalog item "') ||
    error.message.startsWith('Product "') ||
    error.message.startsWith('Cannot create contract in') ||
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
    return actionError('One of the selected contract wizard records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('A matching contract wizard record already exists.');
  }

  return null;
}
