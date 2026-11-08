import logger from '@alga-psa/core/logger';
import { serves, type CapabilityKey } from '@alga-psa/core/capability';
import type { BaseJobData } from './interfaces';
import type { JobHandlerFn } from './jobHandlerRegistry';

/**
 * Adapter 4. Wrap a co-managed job handler so a tenant that is not served by
 * the capability completes as a logged skip: no retry, no DLQ, no SQL. Mirrors
 * the suspended-tenant skip in `JobHandlerRegistry.execute`. Jobs without a
 * tenantId (system scope) run unchanged.
 *
 * Imports only the pure capability entry, so worker images never load `next`.
 * Uses `serves`, never `admits`: workers do not depend on PostHog.
 */
export function withCapabilityJob<T extends BaseJobData>(
  capability: CapabilityKey,
  handler: JobHandlerFn<T>,
): JobHandlerFn<T> {
  return async (jobId, data) => {
    const tenantId = typeof data?.tenantId === 'string' ? data.tenantId : undefined;
    if (tenantId) {
      const decision = await serves(capability, tenantId);
      if (!decision.served) {
        logger.info(`Skipping job: capability ${capability} is closed for tenant`, {
          jobId,
          tenantId,
          capability,
          event: 'job_skipped_capability_closed',
        });
        return;
      }
    }
    await handler(jobId, data);
  };
}
