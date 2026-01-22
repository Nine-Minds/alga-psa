'use server'

import CreditReconciliationReport from '../models/creditReconciliationReport';
import { ReconciliationStatus } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { getCurrentUser } from '@alga-psa/users/actions';
// Mock function for getting client by ID - in a real implementation, this would be imported from a client model
async function getClientById(clientId: string) {
  // This is a placeholder - in a real implementation, you would fetch the client from the database
  const mockClients = {
    'client1': { id: 'client1', name: 'Acme Inc' },
    'client2': { id: 'client2', name: 'Globex Corp' },
    'client3': { id: 'client3', name: 'Initech' },
    'client4': { id: 'client4', name: 'Umbrella Corp' }
  };
  
  return mockClients[clientId as keyof typeof mockClients] || null;
}

/**
 * Fetch reconciliation reports with pagination and filtering
 * @param options Filtering and pagination options
 * @returns Object containing reports and pagination info
 */
export async function fetchReconciliationReports({
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
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
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

    // Fetch client names for each report
    const reportsWithClientNames = await Promise.all(
      result.reports.map(async (report) => {
        const client = await getClientById(report.client_id);
        return {
          ...report,
          client_name: client?.name || 'Unknown Client'
        };
      })
    );

      return {
        ...result,
        reports: reportsWithClientNames
      };
    } catch (error) {
      console.error('Error fetching reconciliation reports:', error);
      throw error;
    }
  });
}

/**
 * Fetch all clients for the dropdown
 * @returns Array of client objects with id and name
 */
export async function fetchClientsForDropdown() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
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
}

/**
 * Fetch summary statistics for reconciliation reports
 * @returns Object containing summary statistics
 */
export async function fetchReconciliationStats() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex: db, tenant } = await createTenantKnex(currentUser.tenant);
  return withTransaction(db, async (trx: Knex.Transaction) => {
    try {
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
}
