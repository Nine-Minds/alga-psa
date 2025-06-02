// Universal server action for executing reports

'use server';

import { z } from 'zod';
import { ReportEngine } from '../core/ReportEngine';
import { ReportRegistry } from '../core/ReportRegistry';
import { ReportResult, ReportValidationError, ReportExecutionError } from '../core/types';

const ExecuteReportSchema = z.object({
  reportId: z.string().min(1, 'Report ID is required'),
  parameters: z.record(z.any()).optional(),
  options: z.object({
    skipCache: z.boolean().optional(),
    forceRefresh: z.boolean().optional(),
    timeout: z.number().optional()
  }).optional()
});

export type ExecuteReportInput = z.infer<typeof ExecuteReportSchema>;

/**
 * Execute a report by ID with optional parameters
 */
export async function executeReport(
  input: ExecuteReportInput
): Promise<ReportResult> {
  
  // Validate input
  const validationResult = ExecuteReportSchema.safeParse(input);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => 
      `${e.path.join('.')}: ${e.message}`
    ).join(', ');
    throw new ReportValidationError(`Validation Error: ${errorMessages}`);
  }
  
  const { reportId, parameters = {}, options = {} } = validationResult.data;
  
  try {
    // Get report definition from registry
    const definition = ReportRegistry.get(reportId);
    if (!definition) {
      throw new ReportValidationError(`Report definition not found: ${reportId}`);
    }
    
    // Execute the report
    const result = await ReportEngine.execute(definition, parameters, options);
    
    return result;
    
  } catch (error) {
    console.error(`Error executing report ${reportId}:`, error);
    
    if (error instanceof ReportValidationError || error instanceof ReportExecutionError) {
      throw error;
    }
    
    throw new ReportExecutionError(
      `Failed to execute report: ${error instanceof Error ? error.message : 'Unknown error'}`,
      reportId
    );
  }
}

/**
 * Get available report metadata
 */
export async function getReportMetadata(reportId: string) {
  const definition = ReportRegistry.get(reportId);
  if (!definition) {
    throw new ReportValidationError(`Report definition not found: ${reportId}`);
  }
  
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    version: definition.version,
    metrics: definition.metrics.map(metric => ({
      id: metric.id,
      name: metric.name,
      description: metric.description,
      type: metric.type
    })),
    parameters: definition.parameters || []
  };
}

/**
 * List all available reports
 */
export async function listReports() {
  const reports = ReportRegistry.getAll();
  return Object.values(reports).map(report => ({
    id: report.id,
    name: report.name,
    description: report.description,
    category: report.category,
    version: report.version
  }));
}

/**
 * List reports by category
 */
export async function listReportsByCategory(category: string) {
  const reports = ReportRegistry.getByCategory(category);
  return reports.map(report => ({
    id: report.id,
    name: report.name,
    description: report.description,
    category: report.category,
    version: report.version
  }));
}

// Convenience functions for specific reports

/**
 * Execute the billing overview report
 */
export async function getBillingOverview(): Promise<ReportResult> {
  return executeReport({ reportId: 'billing.overview' });
}

/**
 * Execute billing overview with custom date range
 */
export async function getBillingOverviewForPeriod(
  startDate: string,
  endDate: string
): Promise<ReportResult> {
  return executeReport({
    reportId: 'billing.overview',
    parameters: {
      start_of_month: startDate,
      end_of_month: endDate
    }
  });
}