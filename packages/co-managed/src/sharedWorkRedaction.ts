import { InvalidRedactionError, isReadFieldHidden } from '@alga-psa/authorization/recordProjection';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';

/** Runs a shared redaction predicate; a malformed redaction stays this package's forbidden error. */
export function withCoManagedRedactionError<T>(evaluate: () => T): T {
  try {
    return evaluate();
  } catch (error) {
    if (error instanceof InvalidRedactionError) throw new CoManagedSharedWorkError();
    throw error;
  }
}

/** A redacted source also hides its derived value; nested and parent paths
 * hide the whole candidate rather than return partially identifying objects. */
export function isCoManagedReadFieldHidden(redactions: readonly string[], names: readonly string[]): boolean {
  return withCoManagedRedactionError(() => isReadFieldHidden(redactions, names));
}
