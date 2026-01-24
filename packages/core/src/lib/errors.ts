/**
 * Base application error class for consistent error handling.
 *
 * Migrated from `server/src/lib/errors.ts` so packages do not depend on server internals.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

