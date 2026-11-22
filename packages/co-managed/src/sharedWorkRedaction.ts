import { CoManagedSharedWorkError } from './sharedWorkErrors';
import { isFieldHiddenByRedaction } from '@alga-psa/authorization/redaction';

/** A redacted source also hides its derived value; nested and parent paths
 * hide the whole candidate rather than return partially identifying objects. */
export function isCoManagedReadFieldHidden(redactions: readonly string[], names: readonly string[]): boolean {
  if (redactions.some((field) => typeof field !== 'string')) throw new CoManagedSharedWorkError();
  return isFieldHiddenByRedaction(redactions, names);
}
