import {
  ApplicationFailure,
  log,
  proxyActivities,
} from '@temporalio/workflow';
import type {
  MarketingFanoutSummary,
  MarketingFanoutTenantResult,
  MarketingJobName,
} from '@alga-psa/marketing/lib/marketingJobContract';
import type * as marketingActivities from '../activities/marketing-activities.js';

const MAX_TENANT_CONCURRENCY = 10;

const discoveryActivities = proxyActivities<Pick<
  typeof marketingActivities,
  'listMarketingTenantIds'
>>({
  startToCloseTimeout: '1m',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: '5s',
    maximumInterval: '30s',
  },
});

const tenantActivities = proxyActivities<Pick<
  typeof marketingActivities,
  'runMarketingJobForTenant'
>>({
  startToCloseTimeout: '5m',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: '10s',
    maximumInterval: '1m',
  },
});

export interface MarketingFanoutWorkflowInput {
  jobName: MarketingJobName;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function marketingFanoutWorkflow(
  input: MarketingFanoutWorkflowInput,
): Promise<MarketingFanoutSummary> {
  const tenantIds = await discoveryActivities.listMarketingTenantIds();
  const results = new Array<MarketingFanoutTenantResult>(tenantIds.length);
  let nextTenantIndex = 0;

  const processTenants = async (): Promise<void> => {
    while (nextTenantIndex < tenantIds.length) {
      const tenantIndex = nextTenantIndex++;
      const tenantId = tenantIds[tenantIndex];

      try {
        const result = await tenantActivities.runMarketingJobForTenant({
          jobName: input.jobName,
          tenantId,
        });
        results[tenantIndex] = {
          tenantId,
          status: 'succeeded',
          result,
        };
      } catch (error) {
        results[tenantIndex] = {
          tenantId,
          status: 'failed',
          error: errorMessage(error),
        };
      }
    }
  };

  const workerCount = Math.min(MAX_TENANT_CONCURRENCY, tenantIds.length);
  await Promise.all(Array.from({ length: workerCount }, processTenants));

  const failed = results.filter((result) => result.status === 'failed').length;
  const summary: MarketingFanoutSummary = {
    jobName: input.jobName,
    total: tenantIds.length,
    succeeded: tenantIds.length - failed,
    failed,
    results,
  };

  log.info('Marketing fan-out completed', {
    jobName: summary.jobName,
    total: summary.total,
    succeeded: summary.succeeded,
    failed: summary.failed,
  });

  if (failed > 0) {
    throw ApplicationFailure.nonRetryable(
      `Marketing fan-out failed for ${failed} of ${summary.total} tenants`,
      'MarketingFanoutFailure',
      summary,
    );
  }

  return summary;
}
