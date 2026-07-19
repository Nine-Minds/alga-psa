import logger from '@alga-psa/core/logger';
import { isFeatureFlagEnabled } from '@alga-psa/core';
import {
  MARKETING_MODULE_FLAG,
  flipDuePostsInternal,
  expireStaleTargetsInternal,
  sendDueSequenceStepsInternal,
} from '@alga-psa/marketing/lib';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
import { getMarketingSigningSecret } from 'server/src/lib/marketing/signingSecret';

export const MARKETING_FLIP_DUE_POSTS_JOB = 'marketing:flip-due-posts';
export const MARKETING_EXPIRE_STALE_TARGETS_JOB = 'marketing:expire-stale-targets';
export const MARKETING_SEND_SEQUENCE_STEPS_JOB = 'marketing:send-sequence-steps';

export interface MarketingJobData extends Record<string, unknown> {
  tenantId: string;
}

/** Grace period before an awaiting-manual-publish target auto-expires (F027). */
const STALE_TARGET_GRACE_HOURS = 48;

/**
 * Canonical public base URL for absolute links in outbound marketing email
 * (unsubscribe link, tracking pixel, click redirect). NEXTAUTH_URL is the
 * repo's canonical public-base-url env var — notificationLinkResolver and
 * auth both build absolute URLs from it. NEXT_PUBLIC_APP_URL is accepted as
 * a fallback for deployments that only set the public var.
 */
function getPublicBaseUrl(): string {
  const raw =
    process.env.NEXTAUTH_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'http://localhost:3000';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/**
 * Flag gate for every marketing job: when the marketing module is off for
 * the tenant the job is a no-op. A flag-check failure is treated as "off"
 * (never crash the schedule loop on a PostHog hiccup).
 */
async function isMarketingEnabled(tenantId: string): Promise<boolean> {
  try {
    return await isFeatureFlagEnabled(MARKETING_MODULE_FLAG, { tenantId });
  } catch (error) {
    logger.warn('[marketingJobs] Feature-flag check failed; skipping run', {
      tenantId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/** F027 companion: flip scheduled targets whose scheduled_at has passed to awaiting-manual-publish. Idempotent. */
export async function marketingFlipDuePostsHandler(data: MarketingJobData): Promise<void> {
  if (!data.tenantId) throw new Error('Tenant ID is required for the marketing flip-due-posts job');
  if (!await isMarketingEnabled(data.tenantId)) return;
  await runWithTenant(data.tenantId, async () => {
    const knex = await getConnection(data.tenantId);
    const result = await flipDuePostsInternal(knex, data.tenantId);
    logger.info('[marketingFlipDuePostsHandler] Due-post flip complete', {
      tenantId: data.tenantId,
      ...result,
    });
  });
}

/** F027: auto-expire stale awaiting-manual-publish targets after the grace period. Idempotent. */
export async function marketingExpireStaleTargetsHandler(data: MarketingJobData): Promise<void> {
  if (!data.tenantId) throw new Error('Tenant ID is required for the marketing expire-stale-targets job');
  if (!await isMarketingEnabled(data.tenantId)) return;
  await runWithTenant(data.tenantId, async () => {
    const knex = await getConnection(data.tenantId);
    const result = await expireStaleTargetsInternal(knex, data.tenantId, STALE_TARGET_GRACE_HOURS);
    logger.info('[marketingExpireStaleTargetsHandler] Stale-target expiry complete', {
      tenantId: data.tenantId,
      graceHours: STALE_TARGET_GRACE_HOURS,
      ...result,
    });
  });
}

/** F049: send due sequence steps (compliance footer + tracking links built from the public base URL). */
export async function marketingSendSequenceStepsHandler(data: MarketingJobData): Promise<void> {
  if (!data.tenantId) throw new Error('Tenant ID is required for the marketing send-sequence-steps job');
  if (!await isMarketingEnabled(data.tenantId)) return;
  const signingSecret = await getMarketingSigningSecret();
  if (!signingSecret) {
    // Fail closed: unsigned tracking links would be refused by the click
    // redirect anyway, so don't send at all.
    throw new Error('No marketing signing secret available (NEXTAUTH_SECRET); refusing to send sequence steps');
  }
  await runWithTenant(data.tenantId, async () => {
    const knex = await getConnection(data.tenantId);
    const result = await sendDueSequenceStepsInternal(knex, data.tenantId, {
      baseUrl: getPublicBaseUrl(),
      signingSecret,
    });
    logger.info('[marketingSendSequenceStepsHandler] Sequence send pass complete', {
      tenantId: data.tenantId,
      ...result,
    });
  });
}
