/**
 * Extension Audit Service
 *
 * Tracks ALL extension activity for security and debugging.
 * Logs are stored in the extension_audit_logs table.
 *
 * Supports:
 * - Platform reports (report.list, report.create, report.execute, etc.)
 * - Tenant management (tenant.list, tenant.create, tenant.resend_email, etc.)
 * - Any future extension features
 */

import { getAdminConnection } from '@alga-psa/db/admin';

// Report-related events
export type ReportEventType =
  | 'report.list'
  | 'report.view'
  | 'report.create'
  | 'report.update'
  | 'report.delete'
  | 'report.execute'
  | 'schema.view';

// Tenant management events
export type TenantEventType =
  | 'tenant.list'
  | 'tenant.view'
  | 'tenant.create'
  | 'tenant.resend_email'
  | 'tenant.cancel_subscription'
  | 'tenant.delete';

// General events
export type GeneralEventType = 'extension.access';

export type AuditEventType = ReportEventType | TenantEventType | GeneralEventType;

export type ResourceType = 'report' | 'tenant' | 'user' | 'subscription';
export type AuditStatus = 'pending' | 'completed' | 'failed' | 'running';

export interface AuditLogEntry {
  log_id: string;
  tenant: string;
  event_type: AuditEventType;
  user_id: string | null;
  user_email: string | null;
  resource_type: ResourceType | null;
  resource_id: string | null;
  resource_name: string | null;
  workflow_id: string | null;
  status: AuditStatus | null;
  error_message: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface LogEventInput {
  eventType: AuditEventType;
  userId?: string | null;
  userEmail?: string | null;
  resourceType?: ResourceType | null;
  resourceId?: string | null;
  resourceName?: string | null;
  workflowId?: string | null;
  status?: AuditStatus | null;
  errorMessage?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ListLogsOptions {
  eventType?: AuditEventType;
  eventTypePrefix?: string;  // e.g., 'tenant.' to get all tenant events
  userId?: string;
  resourceType?: ResourceType;
  resourceId?: string;
  status?: AuditStatus;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class ExtensionAuditService {
  private masterTenantId: string;

  constructor(masterTenantId: string) {
    this.masterTenantId = masterTenantId;
  }

  /**
   * Log an audit event
   */
  async logEvent(input: LogEventInput): Promise<string | null> {
    try {
      const knex = await getAdminConnection();

      const [result] = await knex('extension_audit_logs')
        .insert({
          tenant: this.masterTenantId,
          event_type: input.eventType,
          user_id: input.userId || null,
          user_email: input.userEmail || null,
          resource_type: input.resourceType || null,
          resource_id: input.resourceId || null,
          resource_name: input.resourceName || null,
          workflow_id: input.workflowId || null,
          status: input.status || null,
          error_message: input.errorMessage || null,
          details: input.details ? JSON.stringify(input.details) : null,
          ip_address: input.ipAddress || null,
          user_agent: input.userAgent || null,
        })
        .returning('log_id');

      return result?.log_id || null;
    } catch (error) {
      // Don't fail the request if logging fails - just log to console
      console.error('[ExtensionAuditService] Failed to log event:', error);
      return null;
    }
  }

  /**
   * Update an existing audit log entry (e.g., to update status after workflow completes)
   */
  async updateLog(
    logId: string,
    updates: {
      status?: AuditStatus;
      workflowId?: string;
      errorMessage?: string;
      details?: Record<string, unknown>;
    }
  ): Promise<void> {
    try {
      const knex = await getAdminConnection();

      const updateData: Record<string, unknown> = {};
      if (updates.status) updateData.status = updates.status;
      if (updates.workflowId) updateData.workflow_id = updates.workflowId;
      if (updates.errorMessage) updateData.error_message = updates.errorMessage;
      if (updates.details) updateData.details = JSON.stringify(updates.details);

      await knex('extension_audit_logs')
        .where({ tenant: this.masterTenantId, log_id: logId })
        .update(updateData);
    } catch (error) {
      console.error('[ExtensionAuditService] Failed to update log:', error);
    }
  }

  /**
   * List audit logs with optional filtering
   */
  async listLogs(options: ListLogsOptions = {}): Promise<AuditLogEntry[]> {
    const knex = await getAdminConnection();

    let query = knex('extension_audit_logs')
      .where('tenant', this.masterTenantId)
      .select('*')
      .orderBy('created_at', 'desc');

    if (options.eventType) {
      query = query.where('event_type', options.eventType);
    }

    if (options.eventTypePrefix) {
      query = query.where('event_type', 'like', `${options.eventTypePrefix}%`);
    }

    if (options.userId) {
      query = query.where('user_id', options.userId);
    }

    if (options.resourceType) {
      query = query.where('resource_type', options.resourceType);
    }

    if (options.resourceId) {
      query = query.where('resource_id', options.resourceId);
    }

    if (options.status) {
      query = query.where('status', options.status);
    }

    if (options.startDate) {
      query = query.where('created_at', '>=', options.startDate);
    }

    if (options.endDate) {
      query = query.where('created_at', '<=', options.endDate);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.offset(options.offset);
    }

    const rows = await query;

    return rows.map(row => ({
      ...row,
      details: row.details
        ? (typeof row.details === 'string' ? JSON.parse(row.details) : row.details)
        : null,
    }));
  }

  /**
   * Get audit log statistics
   */
  async getStats(): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    recentUsers: Array<{ user_id: string; user_email: string; event_count: number }>;
  }> {
    const knex = await getAdminConnection();

    // Total events
    const [{ count: totalEvents }] = await knex('extension_audit_logs')
      .where('tenant', this.masterTenantId)
      .count('* as count');

    // Events by type
    const eventsByTypeRows = await knex('extension_audit_logs')
      .where('tenant', this.masterTenantId)
      .select('event_type')
      .count('* as count')
      .groupBy('event_type');

    const eventsByType: Record<string, number> = {};
    for (const row of eventsByTypeRows) {
      eventsByType[row.event_type] = Number(row.count);
    }

    // Recent active users (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentUsers = await knex('extension_audit_logs')
      .where('tenant', this.masterTenantId)
      .where('created_at', '>=', thirtyDaysAgo)
      .whereNotNull('user_id')
      .select('user_id', 'user_email')
      .count('* as event_count')
      .groupBy('user_id', 'user_email')
      .orderBy('event_count', 'desc')
      .limit(10);

    return {
      totalEvents: Number(totalEvents),
      eventsByType,
      recentUsers: recentUsers.map(r => ({
        user_id: String(r.user_id),
        user_email: String(r.user_email || ''),
        event_count: Number(r.event_count),
      })),
    };
  }
}

// Backwards compatibility alias
export const PlatformReportAuditService = ExtensionAuditService;

/**
 * Helper to extract client info from request
 */
export function extractClientInfo(request: Request): { ipAddress: string | null; userAgent: string | null } {
  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null;
  const userAgent = request.headers.get('user-agent') || null;

  return { ipAddress, userAgent };
}
