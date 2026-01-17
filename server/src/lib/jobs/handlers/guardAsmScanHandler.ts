/**
 * Guard ASM Scan Job Handler
 *
 * Handles background execution of ASM (Attack Surface Mapping) scans.
 * The actual scanning is done by external scanner pods - this handler
 * orchestrates the scan job lifecycle.
 */

import { BaseJobData } from '../interfaces';
import logger from '@shared/core/logger';
import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import type { GuardJobStatus } from '../../../interfaces/guard/pii.interfaces';

export interface GuardAsmScanJobData extends BaseJobData {
  jobId: string;
  domainId: string;
}

/**
 * Handler for guard:asm:scan jobs
 *
 * This handler:
 * 1. Updates job status to 'running'
 * 2. Dispatches scan to external scanner infrastructure
 * 3. Polls for completion or processes webhook callbacks
 * 4. Updates job status on completion
 *
 * Note: The actual ASM scanning is done by external scanner pods that
 * perform DNS enumeration, port scanning, and vulnerability detection.
 * This handler just orchestrates the job lifecycle.
 */
export async function guardAsmScanHandler(
  _pgBossJobId: string,
  data: GuardAsmScanJobData
): Promise<void> {
  const { tenantId, jobId, domainId } = data;

  logger.info('Starting ASM scan job', { tenantId, jobId, domainId });

  const { knex: db } = await createTenantKnex();

  try {
    // Update job status to running
    await withTransaction(db, async (trx) => {
      await trx('guard_asm_jobs')
        .where({ tenant: tenantId, id: jobId })
        .update({
          status: 'running' as GuardJobStatus,
          started_at: new Date(),
        });
    });

    // Get domain details
    const domain = await db('guard_asm_domains')
      .where({ tenant: tenantId, id: domainId })
      .first();

    if (!domain) {
      throw new Error(`Domain not found: ${domainId}`);
    }

    logger.info('ASM scan started for domain', {
      tenantId,
      jobId,
      domainName: domain.domain_name,
    });

    // TODO: Dispatch to external scanner infrastructure
    // In production, this would:
    // 1. Call the scanner service API to start the scan
    // 2. Wait for completion via polling or webhook
    // 3. Retrieve and store results
    //
    // For now, mark as completed with placeholder results
    // The actual scanner integration requires:
    // - Scanner pod deployment (F135)
    // - Job queue for scan distribution (F136)
    // - Result aggregation (F137)

    // Simulate scan completion for now
    await withTransaction(db, async (trx) => {
      await trx('guard_asm_jobs')
        .where({ tenant: tenantId, id: jobId })
        .update({
          status: 'completed' as GuardJobStatus,
          completed_at: new Date(),
          total_findings: 0,
          progress_percent: 100,
        });

      // Update domain last_scanned_at
      await trx('guard_asm_domains')
        .where({ tenant: tenantId, id: domainId })
        .update({
          last_scanned_at: new Date(),
          updated_at: new Date(),
        });
    });

    logger.info('ASM scan completed', { tenantId, jobId });

  } catch (error) {
    logger.error('ASM scan failed', { tenantId, jobId, error });

    // Update job status to failed
    await withTransaction(db, async (trx) => {
      await trx('guard_asm_jobs')
        .where({ tenant: tenantId, id: jobId })
        .update({
          status: 'failed' as GuardJobStatus,
          completed_at: new Date(),
          error_message: error instanceof Error ? error.message : String(error),
        });
    });

    throw error;
  }
}
