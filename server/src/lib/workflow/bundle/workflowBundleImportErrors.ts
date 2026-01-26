export type WorkflowBundleImportErrorCode =
  | 'INVALID_BUNDLE'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_FORMAT_VERSION'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'WORKFLOW_KEY_CONFLICT'
  | 'MISSING_DEPENDENCIES';

export class WorkflowBundleImportError extends Error {
  code: WorkflowBundleImportErrorCode;
  status: number;
  details?: unknown;

  constructor(code: WorkflowBundleImportErrorCode, message: string, opts?: { status?: number; details?: unknown }) {
    super(message);
    this.code = code;
    this.status = opts?.status ?? 400;
    this.details = opts?.details;
  }
}

