/**
 * Platform Reports Audit Service
 *
 * Tracks all access and actions on platform reports for security and debugging.
 * Logs are stored in the custom_reports_audit table.
 */

import { getAdminConnection } from '@alga-psa/shared/db/admin';

export type AuditEventType =
  | 'report.list'
  | 'report.view'
  | 'report.create'
  | 'report.update'
  | 'report.delete'
  | 'report.execute'
  | 'schema.view'
  | 'extension.access';

export interface AuditLogEntry {
  log_id: string;
  tenant: string;
  event_type: AuditEventType;
  user_id: string | null;
  user_email: string | null;
  report_id: string | null;
  report_name: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface LogEventInput {
  eventType: AuditEventType;
  userId?: string | null;
  userEmail?: string | null;
  reportId?: string | null;
  reportName?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ListLogsOptions {
  eventType?: AuditEventType;
  userId?: string;
  reportId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class PlatformReportAuditService {
  private masterTenantId: string;

  constructor(masterTenantId: string) {
    this.masterTenantId = masterTenantId;
  }

  /**
   * Log an audit event
   */
  async logEvent(input: LogEventInput): Promise<void> {
    try {
      const knex = await getAdminConnection();

      await knex('custom_reports_audit').insert({
        tenant: this.masterTenantId,
        event_type: input.eventType,
        user_id: input.userId || null,
        user_email: input.userEmail || null,
        report_id: input.reportId || null,
        report_name: input.reportName || null,
        details: input.details ? JSON.stringify(input.details) : null,
        ip_address: input.ipAddress || null,
        user_agent: input.userAgent || null,
      });
    } catch (error) {
      // Don't fail the request if logging fails - just log to console
      console.error('[PlatformReportAuditService] Failed to log event:', error);
    }
  }

  /**
   * List audit logs with optional filtering
   */
  async listLogs(options: ListLogsOptions = {}): Promise<AuditLogEntry[]> {
    const knex = await getAdminConnection();

    let query = knex('custom_reports_audit')
      .where('tenant', this.masterTenantId)
      .select('*')
      .orderBy('created_at', 'desc');

    if (options.eventType) {
      query = query.where('event_type', options.eventType);
    }

    if (options.userId) {
      query = query.where('user_id', options.userId);
    }

    if (options.reportId) {
      query = query.where('report_id', options.reportId);
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
    const [{ count: totalEvents }] = await knex('custom_reports_audit')
      .where('tenant', this.masterTenantId)
      .count('* as count');

    // Events by type
    const eventsByTypeRows = await knex('custom_reports_audit')
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

    const recentUsers = await knex('custom_reports_audit')
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
        user_id: r.user_id,
        user_email: r.user_email || '',
        event_count: Number(r.event_count),
      })),
    };
  }
}

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
