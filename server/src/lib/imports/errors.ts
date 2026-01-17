import { AppError } from '@/lib/errors';
import logger from '@alga-psa/core/logger';

export const IMPORT_VALIDATION_ERROR = 'IMPORT_VALIDATION_ERROR';
export const DUPLICATE_DETECTION_ERROR = 'DUPLICATE_DETECTION_ERROR';

export interface ImportErrorContext {
  tenantId?: string;
  importJobId?: string;
  importSourceId?: string;
  rowNumber?: number;
  field?: string;
  value?: unknown;
  suggestion?: string;
}

/**
 * Raised when a record fails validation during parsing or preview.
 * Carries row-level metadata so the UI can surface actionable feedback.
 */
export class ImportValidationError extends AppError {
  public readonly rowNumber: number;
  public readonly field: string;
  public readonly value: unknown;
  public readonly suggestion?: string;

  constructor(
    rowNumber: number,
    field: string,
    value: unknown,
    message: string,
    suggestion?: string,
    context: Omit<ImportErrorContext, 'rowNumber' | 'field' | 'value' | 'suggestion'> = {}
  ) {
    super(IMPORT_VALIDATION_ERROR, message, {
      ...context,
      rowNumber,
      field,
      value,
      suggestion
    });
    this.rowNumber = rowNumber;
    this.field = field;
    this.value = value;
    this.suggestion = suggestion;
  }
}

/**
 * Raised when duplicate detection fails to execute or returns conflicting matches.
 */
export class DuplicateDetectionError extends AppError {
  public readonly importSourceId?: string;
  public readonly importJobId?: string;
  public readonly detectionDetails?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      importSourceId?: string;
      importJobId?: string;
      detectionDetails?: Record<string, unknown>;
    } = {}
  ) {
    super(DUPLICATE_DETECTION_ERROR, message, {
      importSourceId: options.importSourceId,
      importJobId: options.importJobId,
      detectionDetails: options.detectionDetails
    });
    this.importSourceId = options.importSourceId;
    this.importJobId = options.importJobId;
    this.detectionDetails = options.detectionDetails;
  }
}

export const isImportValidationError = (error: unknown): error is ImportValidationError =>
  error instanceof ImportValidationError;

export const isDuplicateDetectionError = (error: unknown): error is DuplicateDetectionError =>
  error instanceof DuplicateDetectionError;

export const logImportError = (
  error: unknown,
  context: ImportErrorContext = {}
): void => {
  const payload = {
    ...context,
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  };

  logger.error('[Import] error encountered', payload);
};
