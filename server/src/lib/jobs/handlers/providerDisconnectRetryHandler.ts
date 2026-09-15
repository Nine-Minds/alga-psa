import { Job } from 'pg-boss';
import logger from '@alga-psa/core/logger';
import { providerDisconnectRetryHandler as runRetry } from '@alga-psa/jobs/handlers/providerDisconnectRetryHandler';

export interface ProviderDisconnectRetryJobData {
  tenantId?: string;
  [key: string]: unknown;
}

export const PROVIDER_DISCONNECT_RETRY_JOB = 'provider-disconnect-retry';

/**
 * CE pg-boss per-tenant handler: retries pending provider disconnects whose
 * retry window has arrived. EE runs the same shared implementation through the
 * Temporal maintenance fan-out.
 */
export async function providerDisconnectRetryJobHandler(job: Job<ProviderDisconnectRetryJobData>) {
  const { tenantId } = job.data || {};
  try {
    const result = await runRetry({ tenantId });
    logger.info('Provider disconnect retry completed', { tenantId, result });
    return result;
  } catch (error) {
    logger.error('Provider disconnect retry job failed', { tenantId, error });
    throw error;
  }
}
