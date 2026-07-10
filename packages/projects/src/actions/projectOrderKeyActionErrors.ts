import {
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type ProjectOrderKeyActionError = ActionMessageError | ActionPermissionError;

export function isProjectOrderKeyActionError(value: unknown): value is ProjectOrderKeyActionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}
