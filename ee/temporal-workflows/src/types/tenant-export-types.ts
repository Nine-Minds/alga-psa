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
  /** URL expiration in seconds (default: 1 hour = 3600) */
  urlExpiresIn?: number;
}

export interface ExportTenantDataResult {
  success: boolean;
  exportId?: string;
  /** S3 key where the export is stored (permanent) */
  s3Key?: string;
  /** Presigned download URL (time-limited) */
  downloadUrl?: string;
  /** When the download URL expires */
  urlExpiresAt?: ISO8601String;
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
