// server/src/lib/errors.ts

/**
 * Base application error class for consistent error handling.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name; // Set the error name to the class name
    this.code = code; // Custom error code (e.g., 'QBO_AUTH_ERROR', 'VALIDATION_FAILED')
    this.details = details; // Optional additional context

    // Maintain stack trace (important for V8 environments)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// Example specific error types (optional)
// export class ValidationError extends AppError {
//   constructor(message: string = 'Validation failed', details?: Record<string, any>) {
//     super('VALIDATION_ERROR', message, details);
//   }
// }

// export class AuthorizationError extends AppError {
//   constructor(message: string = 'Authorization failed', details?: Record<string, any>) {
//     super('AUTH_ERROR', message, details);
//   }
// }

// export class NotFoundError extends AppError {
//   constructor(message: string = 'Resource not found', details?: Record<string, any>) {
//     super('NOT_FOUND', message, details);
//   }
// }