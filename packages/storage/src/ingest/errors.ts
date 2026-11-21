/**
 * Errors raised by the upload ingest pipeline. Both carry a stable `code` and an
 * HTTP-ish `status` so entry points can map them (413 / 415) without string matching.
 */
export const UPLOAD_SIZE_LIMIT_EXCEEDED = 'UPLOAD_SIZE_LIMIT_EXCEEDED';
export const UPLOAD_CONTENT_TYPE_REJECTED = 'UPLOAD_CONTENT_TYPE_REJECTED';

export class UploadSizeLimitError extends Error {
  readonly code = UPLOAD_SIZE_LIMIT_EXCEEDED;
  readonly status = 413;
  constructor(public readonly limit: number) {
    // Message prefix matches the legacy validateFileUpload error.
    super(`File size exceeds limit of ${limit} bytes`);
    this.name = 'UploadSizeLimitError';
  }
}

export class UploadContentTypeError extends Error {
  readonly code = UPLOAD_CONTENT_TYPE_REJECTED;
  readonly status = 415;
  constructor(
    message: string,
    public readonly declaredMime: string,
    public readonly detectedMime: string | undefined
  ) {
    super(message);
    this.name = 'UploadContentTypeError';
  }
}

export function isUploadSizeLimitError(error: unknown): error is UploadSizeLimitError {
  return error instanceof UploadSizeLimitError || (error as any)?.code === UPLOAD_SIZE_LIMIT_EXCEEDED;
}

export function isUploadContentTypeError(error: unknown): error is UploadContentTypeError {
  return error instanceof UploadContentTypeError || (error as any)?.code === UPLOAD_CONTENT_TYPE_REJECTED;
}
