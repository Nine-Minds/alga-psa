/**
 * An error whose message is written for the operator, not for a log.
 *
 * `entraRouteErrorMessage` used to decide what was safe to surface by matching
 * against a hardcoded list of exact strings, so anything not on the list became
 * "Entra preflight failed." — including the CIPP adapter's own careful "rotate
 * the credential from the Connection tab", which was written precisely so an
 * operator would know what to do and then thrown away one layer up.
 *
 * Throwing this type is the adapter saying "this message is for a person";
 * everything else still collapses to the generic fallback, which is what keeps
 * driver internals and stack detail off the screen.
 */
export type EntraOperatorErrorCode =
  /** The provider did not answer inside the adapter's timeout. */
  | 'timeout'
  /** The provider answered, and refused the stored credential. */
  | 'credential-rejected'
  /** The provider could not be reached at all. */
  | 'unreachable';

export class EntraOperatorError extends Error {
  public readonly code: EntraOperatorErrorCode;

  constructor(code: EntraOperatorErrorCode, message: string) {
    super(message);
    this.name = 'EntraOperatorError';
    this.code = code;
  }
}

export function isEntraOperatorError(error: unknown): error is EntraOperatorError {
  // An instanceof check alone is unreliable across the EE/CE module boundary,
  // where the same class can be loaded twice.
  return (
    error instanceof Error
    && (error as { name?: string }).name === 'EntraOperatorError'
    && typeof (error as { code?: unknown }).code === 'string'
  );
}

/**
 * Whether an axios-shaped failure is the request running out of time rather
 * than the server saying no. Axios reports both a client-side timeout and some
 * socket timeouts this way, and neither carries a response.
 */
export function isTimeoutError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT';
}
