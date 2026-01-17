/**
 * Guard Score Recalculation Job Handler
 *
 * Handles background recalculation of security scores for companies.
 * Triggered automatically after PII or ASM scans complete.
 */

import { BaseJobData } from '../interfaces';
import logger from '@shared/core/logger';
import { recalculateSecurityScore } from '../../actions/guard-actions/scoreActions';

export interface GuardScoreRecalcJobData extends BaseJobData {
  companyId: string;
  triggeredBy: 'pii_scan' | 'asm_scan' | 'manual' | 'scheduled';
  triggeredJobId?: string;
}

/**
 * Handler for guard:score:recalc jobs
 *
 * This handler recalculates the security score for a company based on
 * current PII findings and ASM vulnerabilities. It's typically triggered
 * after scan completion to update the score.
 */
export async function guardScoreRecalcHandler(
  _pgBossJobId: string,
  data: GuardScoreRecalcJobData
): Promise<void> {
  const { tenantId, companyId, triggeredBy, triggeredJobId } = data;

  logger.info('Starting security score recalculation', {
    tenantId,
    companyId,
    triggeredBy,
    triggeredJobId,
  });

  try {
    const score = await recalculateSecurityScore(
      companyId,
      triggeredBy,
      triggeredJobId
    );

    logger.info('Security score recalculated', {
      tenantId,
      companyId,
      score: score.score,
      riskLevel: score.risk_level,
      piiPenalty: score.pii_penalty,
      asmPenalty: score.asm_penalty,
    });

  } catch (error) {
    logger.error('Security score recalculation failed', {
      tenantId,
      companyId,
      error,
    });
    throw error;
  }
}
