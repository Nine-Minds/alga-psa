/**
 * Refusals the audit service raises. The package may not import the API
 * middleware's NotFoundError/ConflictError (server-only), so the service speaks
 * these codes and each caller maps them: the v1 adapter to HTTP errors, the
 * server actions to a message the UI shows verbatim.
 */
export type AssetAuditErrorCode = 'not_found' | 'conflict';

export class AssetAuditError extends Error {
  constructor(public readonly code: AssetAuditErrorCode, message: string) {
    super(message);
    this.name = 'AssetAuditError';
  }
}

export function isAssetAuditError(error: unknown): error is AssetAuditError {
  return error instanceof AssetAuditError;
}
