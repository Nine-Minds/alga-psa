import {
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type TagActionError = ActionMessageError | ActionPermissionError;

export function isTagActionError(value: unknown): value is TagActionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}
