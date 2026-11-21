/** Error type shared by the EE boundary and its lightweight entry adapter. */
export class BoundaryError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = 'ServicePrincipalBoundaryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Rewrites errors that only EE can describe (R5.4, R5.9). The seam erases class
 * identity, so match on the error name.
 */
export function mapServicePrincipalError<T>(error: T): T {
  const err = error as unknown as { name?: string; field?: string; message?: string };
  if (err && err.name === 'HumanWorkOwnerRequiredError') {
    const mapped = new BoundaryError(
      'ACT_AS_REQUIRED',
      `This action must be performed by a person. Send the X-Alga-Act-As header with an active internal user id (the principal must have act-as enabled) so the work is attributed to that user.` +
        (err.field ? ` Field: ${err.field}.` : ''),
      422,
    );
    return mapped as unknown as T;
  }
  return error;
}
