import {
  isActionMessageError,
  type ActionMessageError,
} from '@alga-psa/ui/lib/errorHandling';

export type PriorityActionError = ActionMessageError;

export function isPriorityActionError(value: unknown): value is PriorityActionError {
  return isActionMessageError(value);
}
