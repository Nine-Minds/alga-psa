/**
 * Guard Cleanup Expired Cron Handler
 *
 * Runs weekly to clean up expired data including:
 * - Old completed job records
 * - Expired PII results (past retention period)
 * - Orphaned ASM results
 * - Old audit log entries
 */

import logger from '@shared/core/logger';
import { createTenantKnex } from '../../db';
import { BaseJobData } from '../interfaces';

export interface GuardCleanupExpiredJobData extends BaseJobData {
  /** Number of days to retain completed jobs */
  jobRetentionDays?: number;
  /** Number of days to retain PII results */
  piiRetentionDays?: number;
  /** Number of days to retain audit logs */
  auditRetentionDays?: number;
  /** Dry run mode - log what would be deleted without actually deleting */
  dryRun?: boolean;
}

// Default retention periods
const DEFAULT_JOB_RETENTION_DAYS = 90;
const DEFAULT_PII_RETENTION_DAYS = 365;
const DEFAULT_AUDIT_RETENTION_DAYS = 730; // 2 years

/**
 * Handler for guard:cleanup:expired cron job
 *
 * This cron job runs weekly and:
 * 1. Deletes completed/failed job records older than retention period
 * 2. Deletes PII results older than retention period
 * 3. Deletes orphaned ASM results (no associated domain)
 * 4. Archives or deletes old audit log entries
 */
export async function guardCleanupExpiredHandler(
  _pgBossJobId?: string,
  data?: GuardCleanupExpiredJobData
): Promise<void> {
  const {
    jobRetentionDays = DEFAULT_JOB_RETENTION_DAYS,
    piiRetentionDays = DEFAULT_PII_RETENTION_DAYS,
    auditRetentionDays = DEFAULT_AUDIT_RETENTION_DAYS,
    dryRun = false,
  } = data ?? {};

  logger.info('Starting cleanup of expired guard data', {
    jobRetentionDays,
    piiRetentionDays,
    auditRetentionDays,
    dryRun,
  });

  const { knex: db } = await createTenantKnex();

  const stats = {
    piiJobsDeleted: 0,
    asmJobsDeleted: 0,
    piiResultsDeleted: 0,
    asmResultsDeleted: 0,
    reportJobsDeleted: 0,
    auditLogsDeleted: 0,
    scoreHistoryDeleted: 0,
  };

  try {
    const now = new Date();

    // Calculate cutoff dates
    const jobCutoff = new Date(now.getTime() - jobRetentionDays * 24 * 60 * 60 * 1000);
    const piiCutoff = new Date(now.getTime() - piiRetentionDays * 24 * 60 * 60 * 1000);
    const auditCutoff = new Date(now.getTime() - auditRetentionDays * 24 * 60 * 60 * 1000);

    // 1. Clean up old PII jobs
    stats.piiJobsDeleted = await cleanupOldPiiJobs(db, jobCutoff, dryRun);

    // 2. Clean up old ASM jobs
    stats.asmJobsDeleted = await cleanupOldAsmJobs(db, jobCutoff, dryRun);

    // 3. Clean up old PII results
    stats.piiResultsDeleted = await cleanupOldPiiResults(db, piiCutoff, dryRun);

    // 4. Clean up orphaned ASM results
    stats.asmResultsDeleted = await cleanupOrphanedAsmResults(db, dryRun);

    // 5. Clean up old report jobs and files
    stats.reportJobsDeleted = await cleanupOldReportJobs(db, jobCutoff, dryRun);

    // 6. Clean up old audit logs
    stats.auditLogsDeleted = await cleanupOldAuditLogs(db, auditCutoff, dryRun);

    // 7. Clean up old score history
    stats.scoreHistoryDeleted = await cleanupOldScoreHistory(db, auditCutoff, dryRun);

    // Record cleanup completion
    await recordCleanupCompletion(db, stats, dryRun);

    logger.info('Guard cleanup completed', { stats, dryRun });

  } catch (error) {
    logger.error('Guard cleanup failed', { error });
    throw error;
  }
}

/**
 * Clean up old PII job records
 */
async function cleanupOldPiiJobs(
  db: any,
  cutoff: Date,
  dryRun: boolean
): Promise<number> {
  const query = db('guard_pii_jobs')
    .whereIn('status', ['completed', 'failed'])
    .where('completed_at', '<', cutoff);

  if (dryRun) {
    const count = await query.clone().count('* as count').first();
    return parseInt(count?.count as string, 10) || 0;
  }

  const result = await query.del();
  return result;
}

/**
 * Clean up old ASM job records
 */
async function cleanupOldAsmJobs(
  db: any,
  cutoff: Date,
  dryRun: boolean
): Promise<number> {
  const query = db('guard_asm_jobs')
    .whereIn('status', ['completed', 'failed'])
    .where('completed_at', '<', cutoff);

  if (dryRun) {
    const count = await query.clone().count('* as count').first();
    return parseInt(count?.count as string, 10) || 0;
  }

  const result = await query.del();
  return result;
}

/**
 * Clean up old PII results past retention period
 */
async function cleanupOldPiiResults(
  db: any,
  cutoff: Date,
  dryRun: boolean
): Promise<number> {
  const query = db('guard_pii_results')
    .where('found_at', '<', cutoff);

  if (dryRun) {
    const count = await query.clone().count('* as count').first();
    return parseInt(count?.count as string, 10) || 0;
  }

  const result = await query.del();
  return result;
}

/**
 * Clean up orphaned ASM results (no associated domain)
 */
async function cleanupOrphanedAsmResults(
  db: any,
  dryRun: boolean
): Promise<number> {
  // Find ASM results with no matching domain
  const query = db('guard_asm_results')
    .whereNotExists(
      db('guard_asm_domains')
        .whereRaw('guard_asm_domains.id = guard_asm_results.domain_id')
    );

  if (dryRun) {
    const count = await query.clone().count('* as count').first();
    return parseInt(count?.count as string, 10) || 0;
  }

  const result = await query.del();
  return result;
}

/**
 * Clean up old report jobs and their files
 */
async function cleanupOldReportJobs(
  db: any,
  cutoff: Date,
  dryRun: boolean
): Promise<number> {
  // Get report jobs to delete (so we can clean up files)
  const jobsToDelete = await db('guard_report_jobs')
    .whereIn('status', ['completed', 'failed'])
    .where('completed_at', '<', cutoff)
    .select('id', 'file_path');

  if (dryRun) {
    return jobsToDelete.length;
  }

  // TODO: Delete associated files from storage
  // For production, this would call StorageService to delete files
  // for (const job of jobsToDelete) {
  //   if (job.file_path) {
  //     await storageService.deleteFile(job.file_path);
  //   }
  // }

  // Delete the job records
  if (jobsToDelete.length > 0) {
    await db('guard_report_jobs')
      .whereIn('id', jobsToDelete.map((j: any) => j.id))
      .del();
  }

  return jobsToDelete.length;
}

/**
 * Clean up old audit log entries
 */
async function cleanupOldAuditLogs(
  db: any,
  cutoff: Date,
  dryRun: boolean
): Promise<number> {
  const query = db('guard_audit_log')
    .where('created_at', '<', cutoff);

  if (dryRun) {
    const count = await query.clone().count('* as count').first();
    return parseInt(count?.count as string, 10) || 0;
  }

  const result = await query.del();
  return result;
}

/**
 * Clean up old security score history
 */
async function cleanupOldScoreHistory(
  db: any,
  cutoff: Date,
  dryRun: boolean
): Promise<number> {
  const query = db('guard_security_score_history')
    .where('calculated_at', '<', cutoff);

  if (dryRun) {
    const count = await query.clone().count('* as count').first();
    return parseInt(count?.count as string, 10) || 0;
  }

  const result = await query.del();
  return result;
}

/**
 * Record cleanup completion in audit log
 */
async function recordCleanupCompletion(
  db: any,
  stats: Record<string, number>,
  dryRun: boolean
): Promise<void> {
  await db('guard_audit_log').insert({
    tenant: 'system',
    action: dryRun ? 'cleanup_dry_run' : 'cleanup_completed',
    details: JSON.stringify(stats),
    created_at: new Date(),
  });
}
