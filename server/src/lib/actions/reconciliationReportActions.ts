'use server'

import CreditReconciliationReport from 'server/src/lib/models/creditReconciliationReport';
import { ReconciliationStatus } from 'server/src/interfaces/billing.interfaces';
// Mock function for getting company by ID - in a real implementation, this would be imported from a company model
async function getCompanyById(companyId: string) {
  // This is a placeholder - in a real implementation, you would fetch the company from the database
  const mockCompanies = {
    'company1': { id: 'company1', name: 'Acme Inc' },
    'company2': { id: 'company2', name: 'Globex Corp' },
    'company3': { id: 'company3', name: 'Initech' },
    'company4': { id: 'company4', name: 'Umbrella Corp' }
  };
  
  return mockCompanies[companyId as keyof typeof mockCompanies] || null;
}

/**
 * Fetch reconciliation reports with pagination and filtering
 * @param options Filtering and pagination options
 * @returns Object containing reports and pagination info
 */
export async function fetchReconciliationReports({
  companyId,
  status,
  startDate,
  endDate,
  page = 1,
  pageSize = 10
}: {
  companyId?: string;
  status?: ReconciliationStatus | ReconciliationStatus[];
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}) {
  try {
    // Fetch reports with pagination and filtering
    const result = await CreditReconciliationReport.listReports({
      companyId,
      status,
      startDate,
      endDate,
      page,
      pageSize
    });

    // Fetch company names for each report
    const reportsWithCompanyNames = await Promise.all(
      result.reports.map(async (report) => {
        const company = await getCompanyById(report.company_id);
        return {
          ...report,
          company_name: company?.name || 'Unknown Company'
        };
      })
    );

    return {
      ...result,
      reports: reportsWithCompanyNames
    };
  } catch (error) {
    console.error('Error fetching reconciliation reports:', error);
    throw error;
  }
}

/**
 * Fetch all companies for the dropdown
 * @returns Array of company objects with id and name
 */
export async function fetchCompaniesForDropdown() {
  try {
    // This is a placeholder - in a real implementation, you would fetch companies from the database
    // For now, we'll return a mock list
    return [
      { id: 'company1', name: 'Acme Inc' },
      { id: 'company2', name: 'Globex Corp' },
      { id: 'company3', name: 'Initech' },
      { id: 'company4', name: 'Umbrella Corp' }
    ];
  } catch (error) {
    console.error('Error fetching companies for dropdown:', error);
    throw error;
  }
}

/**
 * Fetch summary statistics for reconciliation reports
 * @returns Object containing summary statistics
 */
export async function fetchReconciliationStats() {
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
}