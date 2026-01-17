/**
 * Guard Report Generation Job Handler
 *
 * Handles background generation of security reports in various formats.
 */

import { BaseJobData } from '../interfaces';
import logger from '@shared/core/logger';
import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { updateReportJobStatus } from '../../actions/guard-actions/reportActions';
import type { GuardJobStatus } from '../../../interfaces/guard/pii.interfaces';
import type { GuardReportType, GuardReportFormat } from '../../../interfaces/guard/report.interfaces';

export interface GuardReportGenerateJobData extends BaseJobData {
  reportId: string;
}

/**
 * Handler for guard:report:generate jobs
 *
 * This handler:
 * 1. Updates report status to 'running'
 * 2. Gathers data based on report type
 * 3. Generates document in requested format
 * 4. Stores file and updates report with path
 *
 * Note: Actual document generation requires:
 * - docx library for Word documents
 * - xlsx library for Excel documents
 * - puppeteer for PDF generation
 */
export async function guardReportGenerateHandler(
  _pgBossJobId: string,
  data: GuardReportGenerateJobData
): Promise<void> {
  const { tenantId, reportId } = data;

  logger.info('Starting report generation', { tenantId, reportId });

  const { knex: db } = await createTenantKnex();

  try {
    // Get report details
    const report = await db('guard_report_jobs')
      .where({ tenant: tenantId, id: reportId })
      .first();

    if (!report) {
      throw new Error(`Report not found: ${reportId}`);
    }

    // Update status to running
    await updateReportJobStatus(reportId, 'running' as GuardJobStatus, {
      started_at: new Date(),
    });

    logger.info('Generating report', {
      tenantId,
      reportId,
      reportType: report.report_type,
      format: report.format,
    });

    // Generate report based on type
    const reportData = await gatherReportData(
      db,
      tenantId,
      report.report_type as GuardReportType,
      report.company_id,
      report.date_from,
      report.date_to
    );

    // Generate document in requested format
    const { filePath, fileSize } = await generateDocument(
      reportData,
      report.report_type as GuardReportType,
      report.format as GuardReportFormat,
      report.name
    );

    // Upload to S3 if configured, otherwise keep local path
    let finalFilePath = filePath;
    let finalFileSize = fileSize;

    const { getStorageMode, uploadReportToS3 } = await import('../../services/guardReportStorage');

    if (getStorageMode() === 's3') {
      logger.info('Uploading report to S3', { tenantId, reportId });
      const uploadResult = await uploadReportToS3(
        tenantId,
        reportId,
        filePath,
        report.format as GuardReportFormat,
        report.name
      );
      // Store the S3 key as the file path (prefixed with s3:// for identification)
      finalFilePath = `s3://${uploadResult.s3Bucket}/${uploadResult.s3Key}`;
      finalFileSize = uploadResult.fileSize;
    }

    // Update status to completed
    await updateReportJobStatus(reportId, 'completed' as GuardJobStatus, {
      completed_at: new Date(),
      file_path: finalFilePath,
      file_size: finalFileSize,
    });

    logger.info('Report generation completed', {
      tenantId,
      reportId,
      filePath,
      fileSize,
    });

  } catch (error) {
    logger.error('Report generation failed', { tenantId, reportId, error });

    await updateReportJobStatus(reportId, 'failed' as GuardJobStatus, {
      completed_at: new Date(),
      error_message: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

/**
 * Gather data for report based on type
 */
async function gatherReportData(
  db: any,
  tenant: string,
  reportType: GuardReportType,
  companyId?: string,
  dateFrom?: Date,
  dateTo?: Date
): Promise<Record<string, unknown>> {
  // Build date filter
  const dateFilter = (query: any, dateColumn: string) => {
    if (dateFrom) {
      query = query.where(dateColumn, '>=', dateFrom);
    }
    if (dateTo) {
      query = query.where(dateColumn, '<=', dateTo);
    }
    return query;
  };

  switch (reportType) {
    case 'pii':
      return gatherPiiReportData(db, tenant, companyId, dateFilter);
    case 'asm':
      return gatherAsmReportData(db, tenant, companyId, dateFilter);
    case 'security_score':
      return gatherScoreReportData(db, tenant, companyId);
    case 'combined':
      const piiData = await gatherPiiReportData(db, tenant, companyId, dateFilter);
      const asmData = await gatherAsmReportData(db, tenant, companyId, dateFilter);
      const scoreData = await gatherScoreReportData(db, tenant, companyId);
      return { pii: piiData, asm: asmData, score: scoreData };
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
}

async function gatherPiiReportData(
  db: any,
  tenant: string,
  companyId?: string,
  dateFilter?: (query: any, dateColumn: string) => any
): Promise<Record<string, unknown>> {
  let findingsQuery = db('guard_pii_results')
    .where({ tenant });

  if (companyId) {
    findingsQuery = findingsQuery.where('company_id', companyId);
  }

  if (dateFilter) {
    findingsQuery = dateFilter(findingsQuery, 'found_at');
  }

  const findings = await findingsQuery
    .select('*')
    .orderBy('found_at', 'desc')
    .limit(1000);

  // Get summary
  const summary = await db('guard_pii_results')
    .where({ tenant })
    .modify((qb: any) => {
      if (companyId) qb.where('company_id', companyId);
    })
    .select('pii_type')
    .count('* as count')
    .groupBy('pii_type');

  return {
    generated_at: new Date(),
    findings,
    summary: Object.fromEntries(summary.map((s: any) => [s.pii_type, parseInt(s.count as string, 10)])),
  };
}

async function gatherAsmReportData(
  db: any,
  tenant: string,
  companyId?: string,
  dateFilter?: (query: any, dateColumn: string) => any
): Promise<Record<string, unknown>> {
  let domainsQuery = db('guard_asm_domains')
    .where({ tenant });

  if (companyId) {
    domainsQuery = domainsQuery.where('company_id', companyId);
  }

  const domains = await domainsQuery.select('*');
  const domainIds = domains.map((d: any) => d.id);

  let resultsQuery = db('guard_asm_results')
    .where({ tenant })
    .whereIn('domain_id', domainIds);

  if (dateFilter) {
    resultsQuery = dateFilter(resultsQuery, 'found_at');
  }

  const results = await resultsQuery
    .select('*')
    .orderBy('found_at', 'desc')
    .limit(1000);

  return {
    generated_at: new Date(),
    domains,
    results,
  };
}

async function gatherScoreReportData(
  db: any,
  tenant: string,
  companyId?: string
): Promise<Record<string, unknown>> {
  if (!companyId) {
    throw new Error('Company ID required for security score report');
  }

  const score = await db('guard_security_scores')
    .where({ tenant, company_id: companyId })
    .first();

  const history = await db('guard_security_score_history')
    .where({ tenant, company_id: companyId })
    .orderBy('calculated_at', 'desc')
    .limit(30);

  return {
    generated_at: new Date(),
    score,
    history,
  };
}

/**
 * Generate document in requested format using GuardReportGenerator
 */
async function generateDocument(
  data: Record<string, unknown>,
  reportType: GuardReportType,
  format: GuardReportFormat,
  name: string
): Promise<{ filePath: string; fileSize: number }> {
  // Import the report generator
  const { guardReportGenerator } = await import('../../services/guardReportGenerator');
  const fs = await import('fs');
  const path = await import('path');

  // Ensure output directory exists
  const outputDir = '/tmp/guard-reports';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate unique filename
  const timestamp = Date.now();
  const sanitizedName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
  const extension = format === 'docx' ? 'txt' : format; // Use .txt for Word until docx is installed
  const outputPath = path.join(outputDir, `${sanitizedName}_${timestamp}.${extension}`);

  // Generate the report
  const result = await guardReportGenerator.generate({
    reportType,
    format,
    name,
    data: {
      generated_at: (data.generated_at as Date) || new Date(),
      pii: data.pii as any,
      asm: data.asm as any,
      score: data.score as any,
    },
    outputPath,
  });

  if (!result.success) {
    throw new Error(result.error || 'Document generation failed');
  }

  return {
    filePath: result.filePath!,
    fileSize: result.fileSize!,
  };
}
