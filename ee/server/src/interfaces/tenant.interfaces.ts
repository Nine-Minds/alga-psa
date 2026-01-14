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
