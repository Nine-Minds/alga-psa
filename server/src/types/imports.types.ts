import type { ImportValidationError } from '@/lib/imports/errors';

/**
 * Supported lifecycle states for high-level import jobs.
 * Aligns with the Postgres enum `import_job_status`.
 */
export type ImportJobStatus =
  | 'preview'
  | 'validating'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Supported lifecycle states for individual import job items.
 * Aligns with the Postgres enum `import_job_item_status`.
 */
export type ImportJobItemStatus =
  | 'staged'
  | 'created'
  | 'updated'
  | 'duplicate'
  | 'error';

/**
 * Field mapping definition between an external column and an internal asset attribute.
 */
export interface FieldMappingDefinition {
  target: string;
  required?: boolean;
  description?: string;
  transformer?: string;
}

/**
 * Saved mapping configuration keyed by source column names.
 */
export type FieldMappingTemplate = Record<string, FieldMappingDefinition>;

/**
 * Runtime mapping selected by an operator for a specific import job.
 */
export interface FieldMapping {
  sourceField: string;
  targetField: string;
  required?: boolean;
  transformer?: string;
}

/**
 * Canonical shape for parsed records produced by an importer.
 */
export interface ParsedRecord {
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized?: Record<string, unknown>;
  externalId?: string;
  metadata?: Record<string, unknown>;
}

export interface FieldDefinition {
  field: string;
  label: string;
  description?: string;
  required?: boolean;
  example?: string;
  parser?: FieldValueParser;
  validators?: FieldValidator[];
}

export type FieldValueParser = (
  value: unknown,
  record: ParsedRecord
) => unknown | Promise<unknown>;

export type FieldValidator = (
  value: unknown,
  record: ParsedRecord
) => ImportValidationError | null | Promise<ImportValidationError | null>;

export interface FieldMappingResult {
  mapped: Record<string, unknown>;
  errors: ImportValidationError[];
}

/**
 * Result of importer-level validation prior to preview or execution.
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ImportValidationError[];
  warnings?: string[];
}

/**
 * Duplicate detection strategy configuration.
 */
export interface DuplicateDetectionStrategy {
  exactFields: string[];
  fuzzyFields?: string[];
  fuzzyThreshold?: number;
  allowMultipleMatches?: boolean;
}

/**
 * Context passed to duplicate detection routines.
 */
export interface DetectionContext {
  tenantId: string;
  importSourceId: string;
  fieldMapping: FieldMapping[];
}

/**
 * Context provided when mapping parsed records to asset payloads.
 */
export interface MapToAssetContext {
  tenantId: string;
  importJobId: string;
  importSourceId: string;
  fieldMapping: FieldMapping[];
}

/**
 * Result returned by duplicate detection routines.
 */
export interface DuplicateCheckResult {
  isDuplicate: boolean;
  matchType?: string;
  matchedAssetId?: string;
  confidence?: number;
  details?: Record<string, unknown>;
}

/**
 * Import source representation as stored in the database.
 */
export interface ImportSourceRecord {
  tenant: string;
  import_source_id: string;
  source_type: string;
  name: string;
  description: string | null;
  field_mapping: FieldMappingTemplate | null;
  duplicate_detection_fields: string[] | null;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/**
 * Import job representation as stored in the database.
 */
export interface ImportJobRecord {
  tenant: string;
  import_job_id: string;
  import_source_id: string;
  job_id: string | null;
  status: ImportJobStatus;
  file_name: string | null;
  total_rows: number;
  processed_rows: number;
  created_rows: number;
  updated_rows: number;
  duplicate_rows: number;
  error_rows: number;
  preview_data: PreviewData | null;
  error_summary: ImportErrorSummary | null;
  context: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  created_by: string;
}

/**
 * Preview dataset stored alongside an import job.
 */
export interface PreviewData {
  rows: PreviewRow[];
  summary: ImportPreviewSummary;
  columnExamples?: Record<string, unknown[]>;
}

export interface PreviewRow {
  rowNumber: number;
  values: Record<string, unknown>;
  validationErrors?: ImportValidationError[];
  duplicate?: DuplicateCheckResult | null;
  externalId?: string;
  externalHash?: string;
}

export interface ImportPreviewSummary {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  errorRows: number;
}

/**
 * Structured error summary stored for quick UI access.
 */
export interface ImportErrorSummary {
  totalErrors: number;
  rowsWithErrors: number;
  topErrors: Array<{
    field: string;
    count: number;
    sampleMessage: string;
  }>;
}

/**
 * Individual job item row.
 */
export interface ImportJobItemRecord {
  tenant: string;
  import_job_item_id: string;
  import_job_id: string;
  external_id: string | null;
  asset_id: string | null;
  source_data: Record<string, unknown>;
  mapped_data: Record<string, unknown> | null;
  duplicate_details: Record<string, unknown> | null;
  status: ImportJobItemStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * External entity mapping record.
 */
export interface ExternalEntityMappingRecord {
  tenant: string;
  external_entity_mapping_id: string;
  asset_id: string;
  import_source_id: string;
  external_id: string;
  external_hash: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  last_synced_at: string;
}

/**
 * Filtering options when listing import jobs.
 */
export interface ImportFilters {
  status?: ImportJobStatus | ImportJobStatus[];
  sourceType?: string;
  createdBy?: string;
  from?: Date;
  to?: Date;
  search?: string;
}

/**
 * Summary counters for import jobs.
 */
export interface ImportJobMetrics {
  totalRows: number;
  processedRows: number;
  created: number;
  updated: number;
  duplicates: number;
  errors: number;
}

/**
 * Descriptor for the uploaded file associated with an import job.
 */
export interface ImportFileReference {
  fileName: string;
  originalName?: string;
  size?: number;
  mimeType?: string;
  tempFilePath?: string;
}

/**
 * Payload required to initialise an import job.
 */
export interface InitiateImportOptions {
  createdBy: string;
  file: ImportFileReference;
  totalRows?: number;
  previewData?: PreviewData | null;
  context?: Record<string, unknown>;
}

/**
 * Detailed job view returned to the UI.
 */
export interface ImportJobDetails extends ImportJobRecord {
  items: ImportJobItemRecord[];
  metrics: ImportJobMetrics;
}

export interface PreviewComputationResult {
  preview: PreviewData;
  summary: ImportPreviewSummary;
  errorSummary: ImportErrorSummary | null;
  metrics: ImportJobMetrics;
}

export interface PreviewGenerationOptions {
  tenantId: string;
  importJobId: string;
  records: ParsedRecord[];
  validator?: (record: ParsedRecord) => Promise<ImportValidationError[]>;
  duplicateDetector?: {
    check(record: ParsedRecord): Promise<DuplicateCheckResult>;
  };
  maxPreviewRows?: number;
  fieldDefinitions?: FieldDefinition[];
  fieldMapping?: FieldMapping[];
}
