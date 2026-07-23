import { Context } from '@temporalio/activity';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { createTenantKnex, runWithTenant } from '@alga-psa/db/tenant.js';
import { expireStaleTargetsInternal, flipDuePostsInternal } from '@alga-psa/marketing/lib/posts';
import { sendDueSequenceStepsInternal } from '@alga-psa/marketing/lib/sequences';
import {
  MARKETING_EXPIRE_STALE_TARGETS_JOB,
  MARKETING_FLIP_DUE_POSTS_JOB,
  MARKETING_SEND_SEQUENCE_STEPS_JOB,
  assertMarketingJobName,
  type MarketingJobInput,
  type MarketingTenantJobResult,
} from '@alga-psa/marketing/lib/marketingJobContract';

const MARKETING_TENANT_DISCOVERY_CONTEXT = '__marketing_fanout_tenant_discovery__';
const STALE_TARGET_GRACE_HOURS = 48;

function activityLogger() {
  return Context.current().log;
}

function getPublicBaseUrl(): string {
  const raw =
    process.env.APPLICATION_URL
    || process.env.NEXTAUTH_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'http://localhost:3000';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

export async function listMarketingTenantIds(): Promise<string[]> {
  const knex = await getAdminConnection();
  const rows = await tenantDb(knex, MARKETING_TENANT_DISCOVERY_CONTEXT)
    .unscoped('tenants', 'marketing fan-out enumerates every tenant before tenant context is known')
    .orderBy('tenant', 'asc')
    .select('tenant') as Array<{ tenant: string }>;

  return rows.map(({ tenant }) => String(tenant));
}

export async function runMarketingJobForTenant(
  input: MarketingJobInput,
): Promise<MarketingTenantJobResult> {
  assertMarketingJobName(input.jobName);
  if (!input.tenantId) {
    throw new Error('Tenant ID is required for a marketing fan-out activity');
  }

  const log = activityLogger();
  log.info('Starting marketing tenant activity', {
    jobName: input.jobName,
    tenantId: input.tenantId,
  });

  try {
    const result = await runWithTenant(input.tenantId, async () => {
      const { knex } = await createTenantKnex(input.tenantId);

      switch (input.jobName) {
        case MARKETING_FLIP_DUE_POSTS_JOB:
          return {
            jobName: input.jobName,
            tenantId: input.tenantId,
            operation: await flipDuePostsInternal(knex, input.tenantId),
            completedAt: new Date().toISOString(),
          };
        case MARKETING_EXPIRE_STALE_TARGETS_JOB:
          return {
            jobName: input.jobName,
            tenantId: input.tenantId,
            operation: await expireStaleTargetsInternal(
              knex,
              input.tenantId,
              STALE_TARGET_GRACE_HOURS,
            ),
            completedAt: new Date().toISOString(),
          };
        case MARKETING_SEND_SEQUENCE_STEPS_JOB: {
          const signingSecret = process.env.NEXTAUTH_SECRET;
          if (!signingSecret) {
            throw new Error(
              'No marketing signing secret available (NEXTAUTH_SECRET); refusing to send sequence steps',
            );
          }
          return {
            jobName: input.jobName,
            tenantId: input.tenantId,
            operation: await sendDueSequenceStepsInternal(knex, input.tenantId, {
              baseUrl: getPublicBaseUrl(),
              signingSecret,
            }),
            completedAt: new Date().toISOString(),
          };
        }
      }
    });

    log.info('Completed marketing tenant activity', {
      jobName: result.jobName,
      tenantId: result.tenantId,
      completedAt: result.completedAt,
      operation: result.operation,
    });
    return result;
  } catch (error) {
    log.error('Marketing tenant activity failed', {
      jobName: input.jobName,
      tenantId: input.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
