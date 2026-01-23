/**
 * Tenant Workflow Interfaces
 *
 * Types for Temporal-based tenant workflows (creation, deletion, etc.)
 */

// ============================================================================
// Tenant Creation Types
// ============================================================================

export interface TenantCreationInput {
  tenantName: string;
  adminUser: {
    firstName: string;
    lastName: string;
    email: string;
  };
  companyName: string;
  clientName: string;
  licenseCount?: number;
  contractLine?: string;
  checkoutSessionId?: string;
}

export interface TenantCreationResult {
  success?: boolean;
  tenantId?: string;
  adminUserId?: string;
  error?: string;
}

export interface TenantWorkflowClientResult {
  available: boolean;
  workflowId?: string;
  runId?: string;
  result?: Promise<TenantCreationResult>;
  error?: string;
}

// ============================================================================
// Resend Welcome Email Types
// ============================================================================

export interface ResendWelcomeEmailInput {
  tenantId: string;
  userId?: string;
  triggeredBy: string;
  triggeredByEmail: string;
}

export interface ResendWelcomeEmailResult {
  success: boolean;
  email?: string;
  tenantName?: string;
  error?: string;
}

export interface ResendWelcomeEmailClientResult {
  available: boolean;
  workflowId?: string;
  runId?: string;
  result?: Promise<ResendWelcomeEmailResult>;
  error?: string;
}

// ============================================================================
// Tenant Deletion Types
// ============================================================================

export interface TenantDeletionInput {
  tenantId: string;
  triggerSource: 'stripe_webhook' | 'nineminds_extension' | 'manual';
  triggeredBy?: string;
  subscriptionExternalId?: string;
  reason?: string;
}

export interface TenantDeletionResult {
  success: boolean;
  deletionId: string;
  tenantId: string;
  status: string;
  deletedAt?: string;
  error?: string;
}

export interface TenantDeletionWorkflowState {
  step: string;
  status: string;
  deletionId: string;
  tenantId: string;
  tenantName?: string;
  stats?: {
    userCount: number;
    activeUserCount: number;
    licenseCount: number;
    ticketCount: number;
    openTicketCount: number;
    invoiceCount: number;
    projectCount: number;
    documentCount: number;
    companyCount: number;
    contactCount: number;
    collectedAt: string;
  };
  confirmationType?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  deletionScheduledFor?: string;
  rollbackReason?: string;
  rolledBackBy?: string;
  error?: string;
}

export type ConfirmationType = 'immediate' | '30_days' | '90_days';

export interface TenantDeletionClientResult {
  available: boolean;
  workflowId?: string;
  runId?: string;
  result?: Promise<TenantDeletionResult>;
  error?: string;
}

// ============================================================================
// Tenant Export Types
// ============================================================================

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

export interface TenantExportInput {
  tenantId: string;
  requestedBy: string;
  reason?: string;
  /** URL expiration in seconds (default: 1 hour = 3600) */
  urlExpiresIn?: number;
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
  /** S3 key where export is stored */
  s3Key?: string;
  /** Presigned download URL */
  downloadUrl?: string;
  /** When download URL expires */
  urlExpiresAt?: string;
  /** File size in bytes */
  fileSizeBytes?: number;
  /** Number of tables exported */
  tableCount?: number;
  /** Total records exported */
  recordCount?: number;
  /** Error message if failed */
  error?: string;
  /** When export started */
  startedAt?: string;
  /** When export completed */
  completedAt?: string;
}

export interface TenantExportResult {
  success: boolean;
  exportId: string;
  tenantId: string;
  tenantName?: string;
  status: TenantExportStatus;
  s3Key?: string;
  downloadUrl?: string;
  urlExpiresAt?: string;
  fileSizeBytes?: number;
  tableCount?: number;
  recordCount?: number;
  error?: string;
}

export interface TenantExportClientResult {
  available: boolean;
  workflowId?: string;
  runId?: string;
  result?: Promise<TenantExportResult>;
  error?: string;
}

// ============================================================================
// Shared Types
// ============================================================================

export interface SignalResult {
  available: boolean;
  success?: boolean;
  error?: string;
}

export interface QueryResult<T> {
  available: boolean;
  data?: T;
  error?: string;
}
