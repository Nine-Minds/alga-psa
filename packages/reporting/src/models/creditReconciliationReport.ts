import { v4 as uuidv4 } from 'uuid';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import type { ICreditReconciliationReport, ReconciliationStatus } from '@alga-psa/types';

interface ListReportsOptions {
  clientId?: string;
  status?: ReconciliationStatus | ReconciliationStatus[];
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

class CreditReconciliationReport {
  /**
   * Create a new credit reconciliation report
   * @param reportData The report data without report_id
   * @param trx Optional transaction object
   * @returns The created report
   */
  static async create(
    reportData: Omit<ICreditReconciliationReport, 'report_id' | 'created_at' | 'updated_at'>,
    trx?: Knex.Transaction,
    tenantId?: string
  ): Promise<ICreditReconciliationReport> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for creating reconciliation report');
    }

    try {
      // Remove any tenant from input data to prevent conflicts
      const { tenant: _, ...dataToInsert } = reportData;
      const reportId = uuidv4();
      const now = new Date().toISOString();

      // Process metadata if it exists
      const dataWithProcessedMetadata = { ...dataToInsert };
      if (dataWithProcessedMetadata.metadata) {
        // Use any as an intermediate type to avoid TypeScript errors
        (dataWithProcessedMetadata as any).metadata = JSON.stringify(dataWithProcessedMetadata.metadata);
      }

      const dbInstance = trx || knex;
      const [createdReport] = await dbInstance('credit_reconciliation_reports')
        .insert({
          report_id: reportId,
          ...dataWithProcessedMetadata,
          tenant,
          created_at: now,
          updated_at: now
        })
        .returning('*');

      if (!createdReport) {
        throw new Error('Failed to create reconciliation report - no record returned');
      }

      // Parse metadata back to object if it exists
      if (createdReport.metadata && typeof createdReport.metadata === 'string') {
        try {
          createdReport.metadata = JSON.parse(createdReport.metadata);
        } catch (e) {
          console.warn(`Failed to parse metadata for report ${reportId}:`, e);
        }
      }

      return createdReport;
    } catch (error) {
      console.error('Error creating reconciliation report:', error);
      throw error;
    }
  }

  /**
   * Get a reconciliation report by ID
   * @param reportId The ID of the report to retrieve
   * @returns The report or null if not found
   */
  static async getById(reportId: string, tenantId?: string): Promise<ICreditReconciliationReport | null> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching reconciliation report');
    }

    try {
      const report = await knex('credit_reconciliation_reports')
        .where({
          report_id: reportId,
          tenant
        })
        .first();

      if (report && report.metadata && typeof report.metadata === 'string') {
        try {
          report.metadata = JSON.parse(report.metadata);
        } catch (e) {
          console.warn(`Failed to parse metadata for report ${reportId}:`, e);
        }
      }

      return report || null;
    } catch (error) {
      console.error(`Error fetching reconciliation report ${reportId}:`, error);
      throw error;
    }
  }

  /**
   * Get reconciliation reports for a specific client
   * @param clientId The client ID
   * @param status Optional status filter
   * @returns Array of reconciliation reports
   */
  static async getByClientId(
    clientId: string,
    status?: ReconciliationStatus | ReconciliationStatus[],
    tenantId?: string
  ): Promise<ICreditReconciliationReport[]> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client reconciliation reports');
    }

    try {
      const query = knex('credit_reconciliation_reports')
        .where({
          client_id: clientId,
          tenant
        })
        .orderBy('detection_date', 'desc');

      if (status) {
        if (Array.isArray(status)) {
          query.whereIn('status', status);
        } else {
          query.where('status', status);
        }
      }

      const reports = await query;

      // Parse metadata for each report
      return reports.map(report => {
        if (report.metadata && typeof report.metadata === 'string') {
          try {
            report.metadata = JSON.parse(report.metadata);
          } catch (e) {
            console.warn(`Failed to parse metadata for report ${report.report_id}:`, e);
          }
        }
        return report;
      });
    } catch (error) {
      console.error(`Error fetching reconciliation reports for client ${clientId}:`, error);
      throw error;
    }
  }

  /**
   * Update a reconciliation report
   * @param reportId The ID of the report to update
   * @param updateData The data to update
   * @param trx Optional transaction object
   * @returns The updated report
   */
  static async update(
    reportId: string,
    updateData: Partial<ICreditReconciliationReport>,
    trx?: Knex.Transaction,
    tenantId?: string
  ): Promise<ICreditReconciliationReport> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for updating reconciliation report');
    }

    try {
      // Remove tenant and report_id from update data to prevent modification
      const { tenant: _, report_id, created_at, updated_at, ...dataToUpdate } = updateData;

      // Process metadata if it exists
      const dataWithProcessedMetadata = { ...dataToUpdate };
      if (dataWithProcessedMetadata.metadata) {
        // Use any as an intermediate type to avoid TypeScript errors
        (dataWithProcessedMetadata as any).metadata = JSON.stringify(dataWithProcessedMetadata.metadata);
      }

      const dbInstance = trx || knex;
      const [updatedReport] = await dbInstance('credit_reconciliation_reports')
        .where({
          report_id: reportId,
          tenant
        })
        .update({
          ...dataWithProcessedMetadata,
          updated_at: new Date().toISOString()
        })
        .returning('*');

      if (!updatedReport) {
        throw new Error(`Reconciliation report ${reportId} not found or belongs to different tenant`);
      }

      // Parse metadata back to object if it exists
      if (updatedReport.metadata && typeof updatedReport.metadata === 'string') {
        try {
          updatedReport.metadata = JSON.parse(updatedReport.metadata);
        } catch (e) {
          console.warn(`Failed to parse metadata for report ${reportId}:`, e);
        }
      }

      return updatedReport;
    } catch (error) {
      console.error(`Error updating reconciliation report ${reportId}:`, error);
      throw error;
    }
  }

  /**
   * List reconciliation reports with filtering and pagination
   * @param options Filtering and pagination options
   * @returns Object containing reports and pagination info
   */
  static async listReports(options: ListReportsOptions = {}, tenantId?: string): Promise<{
    reports: ICreditReconciliationReport[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for listing reconciliation reports');
    }

    const {
      clientId,
      status,
      startDate,
      endDate,
      page = 1,
      pageSize = 20
    } = options;

    try {
      // Build base query
      const baseQuery = knex('credit_reconciliation_reports')
        .where({ tenant });

      // Apply filters
      if (clientId) {
        baseQuery.where('client_id', clientId);
      }

      if (status) {
        if (Array.isArray(status)) {
          baseQuery.whereIn('status', status);
        } else {
          baseQuery.where('status', status);
        }
      }

      if (startDate) {
        baseQuery.where('detection_date', '>=', startDate);
      }

      if (endDate) {
        baseQuery.where('detection_date', '<=', endDate);
      }

      // Get total count for pagination
      const [{ count }] = await baseQuery.clone().count('report_id as count');
      const total = parseInt(count as string);
      const totalPages = Math.ceil(total / pageSize);

      // Get paginated results
      const offset = (page - 1) * pageSize;
      const reports = await baseQuery
        .orderBy('detection_date', 'desc')
        .limit(pageSize)
        .offset(offset);

      // Parse metadata for each report
      const reportsWithParsedMetadata = reports.map(report => {
        if (report.metadata && typeof report.metadata === 'string') {
          try {
            report.metadata = JSON.parse(report.metadata);
          } catch (e) {
            console.warn(`Failed to parse metadata for report ${report.report_id}:`, e);
          }
        }
        return report;
      });

      return {
        reports: reportsWithParsedMetadata,
        total,
        page,
        pageSize,
        totalPages
      };
    } catch (error) {
      console.error('Error listing reconciliation reports:', error);
      throw error;
    }
  }

  /**
   * Resolve a reconciliation report
   * @param reportId The ID of the report to resolve
   * @param resolutionData Resolution data
   * @param trx Optional transaction object
   * @returns The resolved report
   */
  static async resolveReport(
    reportId: string,
    resolutionData: {
      resolution_user: string;
      resolution_notes?: string;
      resolution_transaction_id?: string;
    },
    trx?: Knex.Transaction,
    tenantId?: string
  ): Promise<ICreditReconciliationReport> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for resolving reconciliation report');
    }

    try {
      const dbInstance = trx || knex;
      const now = new Date().toISOString();

      const [resolvedReport] = await dbInstance('credit_reconciliation_reports')
        .where({
          report_id: reportId,
          tenant
        })
        .update({
          status: 'resolved',
          resolution_date: now,
          resolution_user: resolutionData.resolution_user,
          resolution_notes: resolutionData.resolution_notes,
          resolution_transaction_id: resolutionData.resolution_transaction_id,
          updated_at: now
        })
        .returning('*');

      if (!resolvedReport) {
        throw new Error(`Reconciliation report ${reportId} not found or belongs to different tenant`);
      }

      // Parse metadata if it exists
      if (resolvedReport.metadata && typeof resolvedReport.metadata === 'string') {
        try {
          resolvedReport.metadata = JSON.parse(resolvedReport.metadata);
        } catch (e) {
          console.warn(`Failed to parse metadata for report ${reportId}:`, e);
        }
      }

      return resolvedReport;
    } catch (error) {
      console.error(`Error resolving reconciliation report ${reportId}:`, error);
      throw error;
    }
  }
  /**
   * Count open reconciliation reports for a client
   * @param clientId The client ID
   * @returns The number of open reports
   */
  static async countOpenReports(clientId: string, tenantId?: string): Promise<number> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for counting open reconciliation reports');
    }

    try {
      const [{ count }] = await knex('credit_reconciliation_reports')
        .where({
          client_id: clientId,
          tenant,
          status: 'open'
        })
        .count('report_id as count');

      return parseInt(count as string);
    } catch (error) {
      console.error(`Error counting open reconciliation reports for client ${clientId}:`, error);
      throw error;
    }
  }

  /**
   * Count reconciliation reports by status
   * @param status The status to count
   * @returns The number of reports with the given status
   */
  static async countByStatus(status: ReconciliationStatus, tenantId?: string): Promise<number> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for counting reconciliation reports by status');
    }

    try {
      const [{ count }] = await knex('credit_reconciliation_reports')
        .where({
          tenant,
          status
        })
        .count('report_id as count');

      return parseInt(count as string);
    } catch (error) {
      console.error(`Error counting reconciliation reports with status ${status}:`, error);
      throw error;
    }
  }

  /**
   * Get the total discrepancy amount across all reports
   * @returns The total discrepancy amount
   */
  static async getTotalDiscrepancyAmount(tenantId?: string): Promise<number> {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for getting total discrepancy amount');
    }

    try {
      const result = await knex('credit_reconciliation_reports')
        .where({ tenant })
        .sum('difference as total');

      return parseFloat(result[0].total || '0');
    } catch (error) {
      console.error('Error getting total discrepancy amount:', error);
      throw error;
    }
  }
}


export default CreditReconciliationReport;
