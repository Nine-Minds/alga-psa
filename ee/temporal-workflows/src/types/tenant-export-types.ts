/**
 * Tenant Data Export Types
 *
 * Types for exporting tenant data (GDPR, backup, migration, etc.)
 * This is an EE-only feature for Nine Minds internal use via tenant management.
 */

export type ISO8601String = string;

export interface ExportTenantDataInput {
  tenantId: string;
  requestedBy: string;
  reason?: string;
  /** Optional export ID - if not provided, one will be generated */
  exportId?: string;
}

export interface ExportTenantDataResult {
  success: boolean;
  exportId?: string;
  /** S3 bucket where the export is stored */
  bucket?: string;
  /** S3 key where the export is stored (permanent) */
  s3Key?: string;
  fileSizeBytes?: number;
  tableCount?: number;
  recordCount?: number;
  error?: string;
}

export interface GetExportDownloadUrlInput {
  tenantId: string;
  exportId: string;
  /** URL expiration in seconds (default: 1 hour = 3600) */
  expiresIn?: number;
}

export interface GetExportDownloadUrlResult {
  success: boolean;
  downloadUrl?: string;
  expiresAt?: ISO8601String;
  error?: string;
}

export interface ListTenantExportsInput {
  tenantId: string;
}

export interface TenantExportRecord {
  exportId: string;
  tenantId: string;
  tenantName: string;
  exportedAt: ISO8601String;
  requestedBy: string;
  reason?: string;
  fileSizeBytes: number;
  tableCount: number;
  recordCount: number;
  s3Key: string;
}

export interface ListTenantExportsResult {
  success: boolean;
  exports?: TenantExportRecord[];
  error?: string;
}

// Workflow-specific types

export type TenantExportStep =
  | 'initializing'
  | 'validating_tenant'
  | 'collecting_data'
  | 'uploading_to_s3'
  | 'generating_url'
  | 'completed'
  | 'failed';

export type TenantExportStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed';

export interface TenantExportWorkflowInput {
  tenantId: string;
  requestedBy: string;
  reason?: string;
}

export interface TenantExportWorkflowState {
  step: TenantExportStep;
  status: TenantExportStatus;
  exportId: string;
  tenantId: string;
  tenantName?: string;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Current table being exported */
  currentTable?: string;
  /** S3 bucket where export is stored */
  bucket?: string;
  /** S3 key where export is stored */
  s3Key?: string;
  /** File size in bytes */
  fileSizeBytes?: number;
  /** Number of tables exported */
  tableCount?: number;
  /** Total records exported */
  recordCount?: number;
  /** Error message if failed */
  error?: string;
  /** When export started */
  startedAt?: ISO8601String;
  /** When export completed */
  completedAt?: ISO8601String;
}

export interface TenantExportWorkflowResult {
  success: boolean;
  exportId: string;
  tenantId: string;
  tenantName?: string;
  status: TenantExportStatus;
  /** S3 bucket where export is stored */
  bucket?: string;
  /** S3 key where export is stored */
  s3Key?: string;
  fileSizeBytes?: number;
  tableCount?: number;
  recordCount?: number;
  error?: string;
}
