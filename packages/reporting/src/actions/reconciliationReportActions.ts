'use server'

import CreditReconciliationReport from '../models/creditReconciliationReport';
import { ReconciliationStatus } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { getClientLogoUrlsBatch } from '@alga-psa/formatting/avatarUtils';

/**
 * Fetch reconciliation reports with pagination and filtering
 * @param options Filtering and pagination options
 * @returns Object containing reports and pagination info
 */
export const fetchReconciliationReports = withAuth(async (_user, { tenant }, {
  clientId,
  status,
  startDate,
  endDate,
  page = 1,
  pageSize = 10
}: {
  clientId?: string;
  status?: ReconciliationStatus | ReconciliationStatus[];
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}) => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Fetch reports with pagination and filtering
      const result = await CreditReconciliationReport.listReports({
        clientId,
        status,
        startDate,
        endDate,
        page,
        pageSize
      });

      // Resolve real client names in one tenant-scoped query (no N+1).
      const clientIds = Array.from(
        new Set(
          result.reports
            .map((report) => report.client_id)
            .filter((clientId): clientId is string => Boolean(clientId))
        )
      );
      const clientRows = clientIds.length > 0
        ? await trx('clients')
            .where('tenant', tenant)
            .whereIn('client_id', clientIds)
            .select('client_id', 'client_name')
        : [];
      const clientNameMap = new Map<string, string>(
        clientRows.map((row: { client_id: string; client_name: string }) => [row.client_id, row.client_name])
      );
      const reportsWithClientNames = result.reports.map((report) => ({
        ...report,
        client_name: clientNameMap.get(report.client_id) || 'Unknown Client'
      }));

      // Batch-resolve client logos (single call, no N+1)
      const logoUrlsMap = clientIds.length > 0
        ? await getClientLogoUrlsBatch(clientIds, tenant)
        : new Map<string, string | null>();
      const reportsWithLogos = reportsWithClientNames.map((report) => ({
        ...report,
        logoUrl: report.client_id ? logoUrlsMap.get(report.client_id) ?? null : null
      }));

      return {
        ...result,
        reports: reportsWithLogos
      };
    } catch (error) {
      console.error('Error fetching reconciliation reports:', error);
      throw error;
    }
  });
});

/**
 * Fetch all clients for the dropdown
 * @returns Array of client objects with id and name
 */
export const fetchClientsForDropdown = withAuth(async (_user, { tenant }) => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // This is a placeholder - in a real implementation, you would fetch clients from the database
      // For now, we'll return a mock list
      return [
        { id: 'client1', name: 'Acme Inc' },
        { id: 'client2', name: 'Globex Corp' },
        { id: 'client3', name: 'Initech' },
        { id: 'client4', name: 'Umbrella Corp' }
      ];
    } catch (error) {
      console.error('Error fetching clients for dropdown:', error);
      throw error;
    }
  });
});

/**
 * Fetch summary statistics for reconciliation reports
 * @returns Object containing summary statistics
 */
export const fetchReconciliationStats = withAuth(async (_user, { tenant }) => {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
      // Reconciliation reporting remains discrepancy-status and financial-date
      // based. Canonical recurring service periods may be attached elsewhere as
      // explanatory lineage, but they do not drive these report totals.
      // Get total counts by status
      const openCount = await CreditReconciliationReport.countByStatus('open');
      const inReviewCount = await CreditReconciliationReport.countByStatus('in_review');
      const resolvedCount = await CreditReconciliationReport.countByStatus('resolved');
      
      // Get total discrepancy amount
      const totalAmount = await CreditReconciliationReport.getTotalDiscrepancyAmount();
      
      return {
        totalDiscrepancies: openCount + inReviewCount + resolvedCount,
        totalAmount,
        openCount,
        inReviewCount,
        resolvedCount
      };
    } catch (error) {
      console.error('Error fetching reconciliation stats:', error);
      throw error;
    }
  });
});
