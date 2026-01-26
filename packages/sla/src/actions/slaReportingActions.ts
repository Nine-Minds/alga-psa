'use server';

/**
 * SLA Reporting Actions
 *
 * Server actions for SLA dashboard and reporting.
 * Provides metrics, compliance rates, breach statistics, and trend data.
 */

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import {
  ISlaReportingFilters,
  ISlaComplianceRate,
  ISlaAverageTimeMetrics,
  ISlaBreachRateByDimension,
  ISlaTrendDataPoint,
  ISlaRecentBreach,
  ISlaTicketAtRisk,
  ISlaOverview
} from '../types';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Apply common filters to a query builder.
 */
function applyFilters(
  query: Knex.QueryBuilder,
  tenant: string,
  filters: ISlaReportingFilters,
  tableAlias: string = 't'
): Knex.QueryBuilder {
  query.where(`${tableAlias}.tenant`, tenant);

  if (filters.dateFrom) {
    query.where(`${tableAlias}.created_at`, '>=', filters.dateFrom);
  }
  if (filters.dateTo) {
    query.where(`${tableAlias}.created_at`, '<=', filters.dateTo);
  }
  if (filters.boardId) {
    query.where(`${tableAlias}.board_id`, filters.boardId);
  }
  if (filters.clientId) {
    query.where(`${tableAlias}.company_id`, filters.clientId);
  }
  if (filters.priorityId) {
    query.where(`${tableAlias}.priority_id`, filters.priorityId);
  }
  if (filters.technicianId) {
    query.where(`${tableAlias}.assigned_to`, filters.technicianId);
  }
  if (filters.slaPolicyId) {
    query.where(`${tableAlias}.sla_policy_id`, filters.slaPolicyId);
  }

  return query;
}

// ============================================================================
// Compliance Rate Metrics
// ============================================================================

/**
 * Get SLA compliance rate metrics.
 */
export const getSlaComplianceRate = withAuth(async (
  _user,
  { tenant },
  filters: ISlaReportingFilters = {}
): Promise<ISlaComplianceRate> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Get tickets with SLA tracking that have been closed/resolved
    let query = trx('tickets as t')
      .whereNotNull('t.sla_policy_id')
      .where(function() {
        this.whereNotNull('t.sla_response_met')
          .orWhereNotNull('t.sla_resolution_met');
      });

    query = applyFilters(query, tenant, filters);

    const tickets = await query.select(
      't.sla_response_met',
      't.sla_resolution_met'
    );

    const totalTickets = tickets.length;
    let responseMetCount = 0;
    let responseBreachedCount = 0;
    let resolutionMetCount = 0;
    let resolutionBreachedCount = 0;

    for (const ticket of tickets) {
      if (ticket.sla_response_met === true) responseMetCount++;
      if (ticket.sla_response_met === false) responseBreachedCount++;
      if (ticket.sla_resolution_met === true) resolutionMetCount++;
      if (ticket.sla_resolution_met === false) resolutionBreachedCount++;
    }

    const responseTotal = responseMetCount + responseBreachedCount;
    const resolutionTotal = resolutionMetCount + resolutionBreachedCount;

    const responseRate = responseTotal > 0 ? (responseMetCount / responseTotal) * 100 : 100;
    const resolutionRate = resolutionTotal > 0 ? (resolutionMetCount / resolutionTotal) * 100 : 100;
    const overallRate = (responseRate + resolutionRate) / 2;

    return {
      overallRate: Math.round(overallRate * 10) / 10,
      responseRate: Math.round(responseRate * 10) / 10,
      resolutionRate: Math.round(resolutionRate * 10) / 10,
      totalTickets,
      responseMetCount,
      responseBreachedCount,
      resolutionMetCount,
      resolutionBreachedCount
    };
  });
});

// ============================================================================
// Average Time Metrics
// ============================================================================

/**
 * Get average response and resolution time metrics.
 */
export const getAverageTimesMetrics = withAuth(async (
  _user,
  { tenant },
  filters: ISlaReportingFilters = {}
): Promise<ISlaAverageTimeMetrics> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Get average actual times
    let query = trx('tickets as t')
      .whereNotNull('t.sla_policy_id');

    query = applyFilters(query, tenant, filters);

    const avgTimes = await query
      .select(
        trx.raw(`
          AVG(EXTRACT(EPOCH FROM (t.sla_response_at - t.sla_started_at)) / 60) as avg_response_minutes,
          AVG(EXTRACT(EPOCH FROM (t.sla_resolution_at - t.sla_started_at)) / 60) as avg_resolution_minutes
        `)
      )
      .first();

    // Get average target times from policy targets
    let targetQuery = trx('tickets as t')
      .join('sla_policy_targets as spt', function() {
        this.on('t.sla_policy_id', 'spt.sla_policy_id')
            .andOn('t.priority_id', 'spt.priority_id')
            .andOn('t.tenant', 'spt.tenant');
      })
      .whereNotNull('t.sla_policy_id');

    targetQuery = applyFilters(targetQuery, tenant, filters);

    const avgTargets = await targetQuery
      .select(
        trx.raw(`
          AVG(spt.response_time_minutes) as avg_target_response_minutes,
          AVG(spt.resolution_time_minutes) as avg_target_resolution_minutes
        `)
      )
      .first();

    return {
      avgResponseMinutes: Math.round(avgTimes?.avg_response_minutes || 0),
      avgResolutionMinutes: Math.round(avgTimes?.avg_resolution_minutes || 0),
      avgTargetResponseMinutes: Math.round(avgTargets?.avg_target_response_minutes || 0),
      avgTargetResolutionMinutes: Math.round(avgTargets?.avg_target_resolution_minutes || 0)
    };
  });
});

// ============================================================================
// Breach Rate by Dimension
// ============================================================================

/**
 * Get breach rate grouped by priority.
 */
export const getBreachRateByPriority = withAuth(async (
  _user,
  { tenant },
  filters: ISlaReportingFilters = {}
): Promise<ISlaBreachRateByDimension[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('tickets as t')
      .join('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
            .andOn('t.tenant', 'p.tenant');
      })
      .whereNotNull('t.sla_policy_id')
      .where(function() {
        this.whereNotNull('t.sla_response_met')
          .orWhereNotNull('t.sla_resolution_met');
      });

    query = applyFilters(query, tenant, filters);

    const results = await query
      .select(
        't.priority_id as dimension_id',
        'p.priority_name as dimension_name',
        trx.raw('COUNT(*) as total_tickets'),
        trx.raw(`
          SUM(CASE WHEN t.sla_response_met = false OR t.sla_resolution_met = false THEN 1 ELSE 0 END) as breached_count
        `)
      )
      .groupBy('t.priority_id', 'p.priority_name')
      .orderBy('p.priority_order');

    return results.map(row => ({
      dimensionId: row.dimension_id,
      dimensionName: row.dimension_name,
      totalTickets: parseInt(row.total_tickets),
      breachedCount: parseInt(row.breached_count),
      breachRate: Math.round((parseInt(row.breached_count) / parseInt(row.total_tickets)) * 1000) / 10
    }));
  });
});

/**
 * Get breach rate grouped by technician.
 */
export const getBreachRateByTechnician = withAuth(async (
  _user,
  { tenant },
  filters: ISlaReportingFilters = {}
): Promise<ISlaBreachRateByDimension[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('tickets as t')
      .leftJoin('users as u', function() {
        this.on('t.assigned_to', 'u.user_id')
            .andOn('t.tenant', 'u.tenant');
      })
      .whereNotNull('t.sla_policy_id')
      .whereNotNull('t.assigned_to')
      .where(function() {
        this.whereNotNull('t.sla_response_met')
          .orWhereNotNull('t.sla_resolution_met');
      });

    query = applyFilters(query, tenant, filters);

    const results = await query
      .select(
        't.assigned_to as dimension_id',
        trx.raw(`COALESCE(u.first_name || ' ' || u.last_name, 'Unknown') as dimension_name`),
        trx.raw('COUNT(*) as total_tickets'),
        trx.raw(`
          SUM(CASE WHEN t.sla_response_met = false OR t.sla_resolution_met = false THEN 1 ELSE 0 END) as breached_count
        `)
      )
      .groupBy('t.assigned_to', 'u.first_name', 'u.last_name')
      .orderBy('breached_count', 'desc')
      .limit(10);

    return results.map(row => ({
      dimensionId: row.dimension_id,
      dimensionName: row.dimension_name.trim(),
      totalTickets: parseInt(row.total_tickets),
      breachedCount: parseInt(row.breached_count),
      breachRate: Math.round((parseInt(row.breached_count) / parseInt(row.total_tickets)) * 1000) / 10
    }));
  });
});

/**
 * Get breach rate grouped by client.
 */
export const getBreachRateByClient = withAuth(async (
  _user,
  { tenant },
  filters: ISlaReportingFilters = {}
): Promise<ISlaBreachRateByDimension[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('tickets as t')
      .join('companies as c', function() {
        this.on('t.company_id', 'c.company_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .whereNotNull('t.sla_policy_id')
      .where(function() {
        this.whereNotNull('t.sla_response_met')
          .orWhereNotNull('t.sla_resolution_met');
      });

    query = applyFilters(query, tenant, filters);

    const results = await query
      .select(
        't.company_id as dimension_id',
        'c.company_name as dimension_name',
        trx.raw('COUNT(*) as total_tickets'),
        trx.raw(`
          SUM(CASE WHEN t.sla_response_met = false OR t.sla_resolution_met = false THEN 1 ELSE 0 END) as breached_count
        `)
      )
      .groupBy('t.company_id', 'c.company_name')
      .orderBy('breached_count', 'desc')
      .limit(10);

    return results.map(row => ({
      dimensionId: row.dimension_id,
      dimensionName: row.dimension_name,
      totalTickets: parseInt(row.total_tickets),
      breachedCount: parseInt(row.breached_count),
      breachRate: Math.round((parseInt(row.breached_count) / parseInt(row.total_tickets)) * 1000) / 10
    }));
  });
});

// ============================================================================
// Trend Data
// ============================================================================

/**
 * Get SLA compliance trend over time.
 */
export const getSlaTrend = withAuth(async (
  _user,
  { tenant },
  filters: ISlaReportingFilters = {},
  days: number = 30
): Promise<ISlaTrendDataPoint[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const dateFrom = filters.dateFrom || new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let query = trx('tickets as t')
      .whereNotNull('t.sla_policy_id')
      .whereNotNull('t.closed_at')
      .where('t.tenant', tenant)
      .where('t.closed_at', '>=', dateFrom);

    if (filters.dateTo) {
      query.where('t.closed_at', '<=', filters.dateTo);
    }
    if (filters.boardId) {
      query.where('t.board_id', filters.boardId);
    }
    if (filters.clientId) {
      query.where('t.company_id', filters.clientId);
    }

    const results = await query
      .select(
        trx.raw(`DATE(t.closed_at) as date`),
        trx.raw('COUNT(*) as ticket_count'),
        trx.raw(`
          SUM(CASE WHEN t.sla_response_met = false OR t.sla_resolution_met = false THEN 1 ELSE 0 END) as breach_count
        `)
      )
      .groupByRaw('DATE(t.closed_at)')
      .orderBy('date');

    return results.map(row => {
      const ticketCount = parseInt(row.ticket_count);
      const breachCount = parseInt(row.breach_count);
      const metCount = ticketCount - breachCount;
      const complianceRate = ticketCount > 0 ? (metCount / ticketCount) * 100 : 100;

      return {
        date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : row.date,
        complianceRate: Math.round(complianceRate * 10) / 10,
        ticketCount,
        breachCount
      };
    });
  });
});

// ============================================================================
// Recent Breaches
// ============================================================================

/**
 * Get recent SLA breaches.
 */
export const getRecentBreaches = withAuth(async (
  _user,
  { tenant },
  filters: ISlaReportingFilters = {},
  limit: number = 10
): Promise<ISlaRecentBreach[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('tickets as t')
      .join('companies as c', function() {
        this.on('t.company_id', 'c.company_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .join('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
            .andOn('t.tenant', 'p.tenant');
      })
      .leftJoin('users as u', function() {
        this.on('t.assigned_to', 'u.user_id')
            .andOn('t.tenant', 'u.tenant');
      })
      .whereNotNull('t.sla_policy_id')
      .where(function() {
        this.where('t.sla_response_met', false)
          .orWhere('t.sla_resolution_met', false);
      });

    query = applyFilters(query, tenant, filters);

    const results = await query
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title as ticket_title',
        'c.company_name',
        'p.priority_name',
        trx.raw(`COALESCE(u.first_name || ' ' || u.last_name, NULL) as assignee_name`),
        't.sla_response_met',
        't.sla_resolution_met',
        trx.raw(`COALESCE(t.sla_resolution_at, t.sla_response_at, t.updated_at) as breached_at`)
      )
      .orderBy('breached_at', 'desc')
      .limit(limit);

    return results.map(row => ({
      ticketId: row.ticket_id,
      ticketNumber: row.ticket_number,
      ticketTitle: row.ticket_title,
      companyName: row.company_name,
      priorityName: row.priority_name,
      assigneeName: row.assignee_name?.trim() || null,
      responseBreached: row.sla_response_met === false,
      resolutionBreached: row.sla_resolution_met === false,
      breachedAt: row.breached_at instanceof Date ? row.breached_at.toISOString() : row.breached_at
    }));
  });
});

// ============================================================================
// Tickets at Risk
// ============================================================================

/**
 * Get tickets that are at risk of breaching SLA.
 */
export const getTicketsAtRisk = withAuth(async (
  _user,
  { tenant },
  limit: number = 10
): Promise<ISlaTicketAtRisk[]> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const now = new Date();

    // Get open tickets with SLA tracking
    const tickets = await trx('tickets as t')
      .join('companies as c', function() {
        this.on('t.company_id', 'c.company_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .join('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
            .andOn('t.tenant', 'p.tenant');
      })
      .leftJoin('users as u', function() {
        this.on('t.assigned_to', 'u.user_id')
            .andOn('t.tenant', 'u.tenant');
      })
      .join('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
            .andOn('t.tenant', 's.tenant');
      })
      .where('t.tenant', tenant)
      .whereNotNull('t.sla_policy_id')
      .where('s.is_closed', false)
      .whereNull('t.sla_paused_at') // Not paused
      .where(function() {
        // Has pending response or resolution SLA
        this.where(function() {
          this.whereNull('t.sla_response_at')
            .whereNotNull('t.sla_response_due_at');
        }).orWhere(function() {
          this.whereNull('t.sla_resolution_at')
            .whereNotNull('t.sla_resolution_due_at');
        });
      })
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title as ticket_title',
        'c.company_name',
        'p.priority_name',
        trx.raw(`COALESCE(u.first_name || ' ' || u.last_name, NULL) as assignee_name`),
        't.sla_response_at',
        't.sla_response_due_at',
        't.sla_resolution_due_at',
        't.sla_started_at'
      )
      .orderByRaw(`
        LEAST(
          COALESCE(t.sla_response_due_at, '9999-12-31'::timestamp),
          COALESCE(t.sla_resolution_due_at, '9999-12-31'::timestamp)
        ) ASC
      `)
      .limit(limit * 2); // Get more to filter

    const atRiskTickets: ISlaTicketAtRisk[] = [];

    for (const ticket of tickets) {
      // Check response SLA first (if not yet responded)
      if (!ticket.sla_response_at && ticket.sla_response_due_at) {
        const dueAt = new Date(ticket.sla_response_due_at);
        const startedAt = new Date(ticket.sla_started_at);
        const totalMinutes = (dueAt.getTime() - startedAt.getTime()) / (1000 * 60);
        const elapsedMinutes = (now.getTime() - startedAt.getTime()) / (1000 * 60);
        const minutesRemaining = (dueAt.getTime() - now.getTime()) / (1000 * 60);
        const percentElapsed = totalMinutes > 0 ? (elapsedMinutes / totalMinutes) * 100 : 0;

        // At risk if > 50% elapsed
        if (percentElapsed >= 50) {
          atRiskTickets.push({
            ticketId: ticket.ticket_id,
            ticketNumber: ticket.ticket_number,
            ticketTitle: ticket.ticket_title,
            companyName: ticket.company_name,
            priorityName: ticket.priority_name,
            assigneeName: ticket.assignee_name?.trim() || null,
            minutesRemaining: Math.round(minutesRemaining),
            percentElapsed: Math.round(percentElapsed * 10) / 10,
            slaType: 'response',
            dueAt: dueAt.toISOString()
          });
        }
      }

      // Check resolution SLA
      if (ticket.sla_resolution_due_at) {
        const dueAt = new Date(ticket.sla_resolution_due_at);
        const startedAt = new Date(ticket.sla_started_at);
        const totalMinutes = (dueAt.getTime() - startedAt.getTime()) / (1000 * 60);
        const elapsedMinutes = (now.getTime() - startedAt.getTime()) / (1000 * 60);
        const minutesRemaining = (dueAt.getTime() - now.getTime()) / (1000 * 60);
        const percentElapsed = totalMinutes > 0 ? (elapsedMinutes / totalMinutes) * 100 : 0;

        // At risk if > 50% elapsed
        if (percentElapsed >= 50) {
          atRiskTickets.push({
            ticketId: ticket.ticket_id,
            ticketNumber: ticket.ticket_number,
            ticketTitle: ticket.ticket_title,
            companyName: ticket.company_name,
            priorityName: ticket.priority_name,
            assigneeName: ticket.assignee_name?.trim() || null,
            minutesRemaining: Math.round(minutesRemaining),
            percentElapsed: Math.round(percentElapsed * 10) / 10,
            slaType: 'resolution',
            dueAt: dueAt.toISOString()
          });
        }
      }
    }

    // Sort by minutes remaining (most urgent first) and limit
    return atRiskTickets
      .sort((a, b) => a.minutesRemaining - b.minutesRemaining)
      .slice(0, limit);
  });
});

// ============================================================================
// Combined Overview
// ============================================================================

/**
 * Get combined SLA overview for dashboard.
 */
export const getSlaOverview = withAuth(async (
  _user,
  { tenant },
  filters: ISlaReportingFilters = {}
): Promise<ISlaOverview> => {
  const { knex: db } = await createTenantKnex();

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Get compliance metrics
    const complianceResult = await getSlaComplianceRate(_user, { tenant }, filters);
    const averageTimesResult = await getAverageTimesMetrics(_user, { tenant }, filters);

    // Get active ticket counts
    let activeQuery = trx('tickets as t')
      .join('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
            .andOn('t.tenant', 's.tenant');
      })
      .whereNotNull('t.sla_policy_id')
      .where('s.is_closed', false);

    activeQuery = applyFilters(activeQuery, tenant, filters);

    const activeCounts = await activeQuery
      .select(
        trx.raw('COUNT(*) as active_count'),
        trx.raw(`
          SUM(CASE WHEN t.sla_paused_at IS NOT NULL THEN 1 ELSE 0 END) as paused_count
        `),
        trx.raw(`
          SUM(CASE
            WHEN t.sla_response_met = false OR t.sla_resolution_met = false THEN 1
            ELSE 0
          END) as breached_count
        `)
      )
      .first();

    // Get at-risk count (simplified - tickets > 75% elapsed)
    const atRiskTickets = await getTicketsAtRisk(_user, { tenant }, 100);
    const atRiskCount = atRiskTickets.filter(t => t.percentElapsed >= 75 && t.minutesRemaining > 0).length;

    return {
      compliance: complianceResult,
      averageTimes: averageTimesResult,
      activeTicketsCount: parseInt(activeCounts?.active_count || '0'),
      atRiskCount,
      breachedCount: parseInt(activeCounts?.breached_count || '0'),
      pausedCount: parseInt(activeCounts?.paused_count || '0')
    };
  });
});
