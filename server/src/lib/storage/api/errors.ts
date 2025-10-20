export type StorageErrorCode =
  | 'REVISION_MISMATCH'
  | 'QUOTA_EXCEEDED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'LIMIT_EXCEEDED'
  | 'NAMESPACE_DENIED'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class StorageServiceError extends Error {
  code: StorageErrorCode;
  details?: unknown;

  constructor(code: StorageErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'StorageServiceError';
    this.code = code;
    this.details = details;
  }
}

export class StorageValidationError extends StorageServiceError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_FAILED', message, details);
    this.name = 'StorageValidationError';
  }
}

export class StorageQuotaError extends StorageServiceError {
  constructor(message: string, details?: unknown) {
    super('QUOTA_EXCEEDED', message, details);
    this.name = 'StorageQuotaError';
  }
}

export class StorageRevisionMismatchError extends StorageServiceError {
  constructor(message: string) {
    super('REVISION_MISMATCH', message);
    this.name = 'StorageRevisionMismatchError';
  }
}

export class StorageNotFoundError extends StorageServiceError {
  constructor(message: string) {
    super('NOT_FOUND', message);
    this.name = 'StorageNotFoundError';
  }
}

export class StorageLimitError extends StorageServiceError {
  constructor(message: string) {
    super('LIMIT_EXCEEDED', message);
    this.name = 'StorageLimitError';
  }
}
