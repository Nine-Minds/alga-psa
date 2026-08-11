import { Job } from 'pg-boss';
import { tenantDb } from '@alga-psa/db';
import { getConnection } from 'server/src/lib/db/db';
import logger from '@alga-psa/core/logger';
import {
  runInboundEmailRecoveryForTenant,
} from '@alga-psa/shared/services/email/inboundEmailRecovery';

export interface InboundEmailRecoveryJobData {
  tenantId?: string;
  limit?: number;
  [key: string]: unknown;
}

export const INBOUND_EMAIL_RECOVERY_JOB = 'inbound-email-recovery';

const TENANT_ENUMERATION_REASON = 'inbound email recovery enumerates tenants';

export async function inboundEmailRecoveryHandler(job: Job<InboundEmailRecoveryJobData>) {
  const { tenantId, limit } = job.data || {};
  try {
    if (tenantId) {
      const result = await runInboundEmailRecoveryForTenant(tenantId, limit);
      logger.info('Inbound email recovery completed', { tenantId, result });
      return { success: true, ...result };
    }

    const knex = await getConnection(null);
    const tenants = await tenantDb(knex, '__inbound_email_recovery_enumeration__')
      .unscoped('tenants', TENANT_ENUMERATION_REASON)
      .whereNull('suspended_at')
      .select('tenant');

    const results: Array<{ tenantId: string; result: { swept: unknown; mirrored: number; backfilled: number } }> = [];
    for (const record of tenants) {
      try {
        const result = await runInboundEmailRecoveryForTenant(record.tenant, limit);
        results.push({ tenantId: record.tenant, result });
      } catch (error: any) {
        logger.error('Inbound email recovery failed for tenant', {
          tenantId: record.tenant,
          error: error?.message || String(error),
        });
      }
    }
    logger.info('Inbound email recovery completed across tenants', { tenantCount: tenants.length });
    return { success: true, results };
  } catch (error: any) {
    logger.error('Inbound email recovery job failed', error);
    throw error;
  }
}

