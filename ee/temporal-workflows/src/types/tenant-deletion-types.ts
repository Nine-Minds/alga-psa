// Define ISO8601String locally to avoid import issues
export type ISO8601String = string;

// ============================================
// Workflow Input/Output Types
// ============================================

export interface TenantDeletionInput {
  tenantId: string;
  triggerSource: 'stripe_webhook' | 'nineminds_extension' | 'manual';
  triggeredBy?: string; // User ID if manual or extension trigger
  subscriptionExternalId?: string; // Stripe subscription ID if from webhook
  reason?: string;
}

export interface TenantDeletionResult {
  success: boolean;
  deletionId: string;
  tenantId: string;
  status: TenantDeletionStatus;
  deletedAt?: ISO8601String;
  error?: string;
}

// ============================================
// Workflow State Types
// ============================================

export type TenantDeletionStatus =
  | 'pending'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'deleting'
  | 'deleted'
  | 'rolled_back'
  | 'failed';

export type TenantDeletionStep =
  | 'initializing'
  | 'getting_tenant_info'
  | 'deactivating_users'
  | 'canceling_stripe_subscription'
  | 'tagging_client'
  | 'collecting_stats'
  | 'recording_pending_deletion'
  | 'awaiting_confirmation'
  | 'waiting_for_deletion_date'
  | 'rolling_back'
  | 'deleting_tenant_data'
  | 'completed'
  | 'failed';

export interface TenantDeletionWorkflowState {
  step: TenantDeletionStep;
  status: TenantDeletionStatus;
  deletionId: string;
  tenantId: string;
  tenantName?: string;
  stats?: TenantStats;
  confirmationType?: ConfirmationType;
  confirmedBy?: string;
  confirmedAt?: ISO8601String;
  deletionScheduledFor?: ISO8601String;
  rollbackReason?: string;
  rolledBackBy?: string;
  error?: string;
}

// ============================================
// Tenant Statistics Types
// ============================================

export interface TenantStats {
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
  collectedAt: ISO8601String;
}

// ============================================
// Signal Types
// ============================================

export type ConfirmationType = 'immediate' | '30_days' | '90_days';

export interface ConfirmDeletionSignal {
  type: ConfirmationType;
  confirmedBy: string;
}

export interface RollbackDeletionSignal {
  reason: string;
  rolledBackBy: string;
}

// ============================================
// Activity Input/Output Types
// ============================================

export interface DeactivateUsersResult {
  deactivatedCount: number;
}

export interface ReactivateUsersResult {
  reactivatedCount: number;
}

export interface TagClientResult {
  tagId?: string;
}

export interface RecordPendingDeletionInput {
  deletionId: string;
  tenantId: string;
  triggerSource: string;
  triggeredBy?: string;
  subscriptionExternalId?: string;
  workflowId: string;
  workflowRunId: string;
  stats: TenantStats;
}

export interface UpdateDeletionStatusInput {
  deletionId: string;
  status?: TenantDeletionStatus;
  confirmationType?: string;
  confirmedBy?: string;
  deletionScheduledFor?: Date;
  rollbackReason?: string;
  rolledBackBy?: string;
  error?: string;
}

export interface DeleteTenantDataResult {
  success: boolean;
  error?: string;
  deletedRecords?: number;
  tablesAffected?: number;
}
