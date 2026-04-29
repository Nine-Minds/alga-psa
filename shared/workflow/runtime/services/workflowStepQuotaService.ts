import type { Knex } from 'knex';
import { resolveTier, type TenantTier } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';

const WORKFLOW_STEP_LIMIT_METADATA_KEY = 'workflow_step_limit';
const ACTIVE_STATUSES = ['trialing', 'active', 'past_due', 'unpaid'] as const;
const STATUS_PRIORITY: Record<string, number> = {
  trialing: 0,
  active: 1,
  past_due: 2,
  unpaid: 3,
};
const TIER_DEFAULT_LIMITS: Record<TenantTier, number> = {
  solo: 150,
  pro: 750,
  premium: 10000,
};

export type WorkflowStepQuotaPeriodSource = 'stripe_subscription' | 'fallback_calendar';
export type WorkflowStepQuotaLimitSource =
  | 'stripe_price_metadata'
  | 'stripe_product_metadata'
  | 'tier_default'
  | 'unlimited_metadata';

export type WorkflowStepQuotaSummary = {
  tenant: string;
  periodStart: string;
  periodEnd: string;
  periodSource: WorkflowStepQuotaPeriodSource;
  stripeSubscriptionId: string | null;
  effectiveLimit: number | null;
  usedCount: number;
  remaining: number | null;
  tier: TenantTier;
  limitSource: WorkflowStepQuotaLimitSource;
};

export type WorkflowStepQuotaReservationResult =
  | {
    allowed: true;
    summary: WorkflowStepQuotaSummary;
    usedCountAfter: number;
  }
  | {
    allowed: false;
    summary: WorkflowStepQuotaSummary;
  };

export type WorkflowStepQuotaReconciliation = {
  tenant: string;
  periodStart: string;
  periodEnd: string;
  counterUsedCount: number;
  ledgerStepCount: number;
  drift: number;
};

type StripeSubscriptionRow = {
  stripe_subscription_id: string;
  stripe_price_id: string;
  status: string;
  current_period_start: string | Date | null;
  current_period_end: string | Date | null;
};

type MetadataLimit = {
  effectiveLimit: number | null;
  limitSource: WorkflowStepQuotaLimitSource;
};

type UsageRow = {
  tenant: string;
  period_start: string | Date;
  period_end: string | Date;
  period_source: WorkflowStepQuotaPeriodSource;
  stripe_subscription_id: string | null;
  effective_limit: number | null;
  used_count: number;
  limit_source: WorkflowStepQuotaLimitSource;
  tier: TenantTier;
};

function toIso(value: string | Date): string {
  return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();
}

function currentUtcMonthPeriod(now = new Date()): { periodStart: string; periodEnd: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)).toISOString();
  const periodEnd = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)).toISOString();
  return { periodStart, periodEnd };
}

function parseLimitMetadata(raw: unknown, source: 'stripe_price_metadata' | 'stripe_product_metadata'): MetadataLimit | null {
  if (raw == null) return null;

  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'unlimited') {
    return { effectiveLimit: null, limitSource: 'unlimited_metadata' };
  }

  const parsed = Number(normalized);
  if (Number.isInteger(parsed) && parsed > 0) {
    return { effectiveLimit: parsed, limitSource: source };
  }

  return null;
}

function isMetadataValuePresent(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'string' && raw.trim() === '') return false;
  return true;
}

async function hasStripeTables(knex: Knex): Promise<boolean> {
  const [subs, prices, products] = await Promise.all([
    knex.schema.hasTable('stripe_subscriptions'),
    knex.schema.hasTable('stripe_prices'),
    knex.schema.hasTable('stripe_products'),
  ]);
  return subs && prices && products;
}

async function getTenantTier(knex: Knex, tenant: string): Promise<TenantTier> {
  const row = await knex('tenants').where({ tenant }).select('plan').first<{ plan?: string | null }>();
  return resolveTier(row?.plan ?? null).tier;
}

async function findPreferredSubscription(knex: Knex, tenant: string): Promise<StripeSubscriptionRow | null> {
  const subscriptions = await knex<StripeSubscriptionRow>('stripe_subscriptions')
    .where({ tenant })
    .whereIn('status', ACTIVE_STATUSES as unknown as string[])
    .whereNotNull('current_period_start')
    .whereNotNull('current_period_end')
    .select('stripe_subscription_id', 'stripe_price_id', 'status', 'current_period_start', 'current_period_end');

  const sorted = subscriptions
    .filter((row) => row.current_period_start && row.current_period_end)
    .sort((a, b) => {
      const left = STATUS_PRIORITY[a.status] ?? Number.MAX_SAFE_INTEGER;
      const right = STATUS_PRIORITY[b.status] ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return new Date(a.current_period_start as string).getTime() - new Date(b.current_period_start as string).getTime();
    });

  return sorted[0] ?? null;
}

async function resolveMetadataLimit(knex: Knex, tenant: string, priceId: string): Promise<MetadataLimit | null> {
  const price = await knex('stripe_prices')
    .where({ tenant, stripe_price_id: priceId })
    .first<{ metadata?: Record<string, unknown> | null; stripe_product_id?: string | null }>();

  const priceRaw = price?.metadata?.[WORKFLOW_STEP_LIMIT_METADATA_KEY];
  const priceValue = parseLimitMetadata(priceRaw, 'stripe_price_metadata');
  if (priceValue) return priceValue;
  if (isMetadataValuePresent(priceRaw)) {
    logger.warn('[WorkflowStepQuotaService] Invalid workflow_step_limit metadata on Stripe price; falling back', {
      tenant,
      stripePriceId: priceId,
      metadataKey: WORKFLOW_STEP_LIMIT_METADATA_KEY,
      metadataValue: priceRaw,
    });
  }

  if (!price?.stripe_product_id) return null;

  const product = await knex('stripe_products')
    .where({ tenant, stripe_product_id: price.stripe_product_id })
    .first<{ metadata?: Record<string, unknown> | null }>();

  const productRaw = product?.metadata?.[WORKFLOW_STEP_LIMIT_METADATA_KEY];
  const productValue = parseLimitMetadata(productRaw, 'stripe_product_metadata');
  if (productValue) return productValue;
  if (isMetadataValuePresent(productRaw)) {
    logger.warn('[WorkflowStepQuotaService] Invalid workflow_step_limit metadata on Stripe product; falling back to tier default', {
      tenant,
      stripePriceId: priceId,
      stripeProductId: price.stripe_product_id,
      metadataKey: WORKFLOW_STEP_LIMIT_METADATA_KEY,
      metadataValue: productRaw,
    });
  }
  return null;
}

export class WorkflowStepQuotaService {
  async resolveQuotaSummary(knex: Knex, tenant: string, now = new Date()): Promise<WorkflowStepQuotaSummary> {
    const tier = await getTenantTier(knex, tenant);
    const defaultLimit = TIER_DEFAULT_LIMITS[tier];

    let periodStart: string;
    let periodEnd: string;
    let periodSource: WorkflowStepQuotaPeriodSource = 'fallback_calendar';
    let stripeSubscriptionId: string | null = null;
    let effectiveLimit: number | null = defaultLimit;
    let limitSource: WorkflowStepQuotaLimitSource = 'tier_default';

    if (await hasStripeTables(knex)) {
      const subscription = await findPreferredSubscription(knex, tenant);
      if (subscription?.current_period_start && subscription.current_period_end) {
        periodStart = toIso(subscription.current_period_start);
        periodEnd = toIso(subscription.current_period_end);
        periodSource = 'stripe_subscription';
        stripeSubscriptionId = subscription.stripe_subscription_id;

        const metadataLimit = await resolveMetadataLimit(knex, tenant, subscription.stripe_price_id);
        if (metadataLimit) {
          effectiveLimit = metadataLimit.effectiveLimit;
          limitSource = metadataLimit.limitSource;
        }
      } else {
        const fallback = currentUtcMonthPeriod(now);
        periodStart = fallback.periodStart;
        periodEnd = fallback.periodEnd;
        logger.info('[WorkflowStepQuotaService] Using fallback calendar period (no valid active Stripe subscription period)', {
          tenant,
          periodStart,
          periodEnd,
          tier,
        });
      }
    } else {
      const fallback = currentUtcMonthPeriod(now);
      periodStart = fallback.periodStart;
      periodEnd = fallback.periodEnd;
      logger.info('[WorkflowStepQuotaService] Using fallback calendar period (Stripe tables unavailable)', {
        tenant,
        periodStart,
        periodEnd,
        tier,
      });
    }

    const usage = await knex<UsageRow>('workflow_step_usage_periods')
      .where({ tenant, period_start: periodStart, period_end: periodEnd })
      .first();

    const usedCount = usage?.used_count ?? 0;
    const remaining = effectiveLimit == null ? null : Math.max(effectiveLimit - usedCount, 0);

    return {
      tenant,
      periodStart,
      periodEnd,
      periodSource,
      stripeSubscriptionId,
      effectiveLimit,
      usedCount,
      remaining,
      tier,
      limitSource,
    };
  }

  async reserveStepStart(knex: Knex, tenant: string, now = new Date()): Promise<WorkflowStepQuotaReservationResult> {
    return knex.transaction(async (trx) => {
      const summary = await this.resolveQuotaSummary(trx, tenant, now);
      const metadataJson = {
        reservedAt: now.toISOString(),
      };

      await trx('workflow_step_usage_periods')
        .insert({
          tenant: summary.tenant,
          period_start: summary.periodStart,
          period_end: summary.periodEnd,
          period_source: summary.periodSource,
          stripe_subscription_id: summary.stripeSubscriptionId,
          effective_limit: summary.effectiveLimit,
          used_count: 0,
          limit_source: summary.limitSource,
          tier: summary.tier,
          metadata_json: metadataJson,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .onConflict(['tenant', 'period_start', 'period_end'])
        .merge({
          period_source: summary.periodSource,
          stripe_subscription_id: summary.stripeSubscriptionId,
          effective_limit: summary.effectiveLimit,
          limit_source: summary.limitSource,
          tier: summary.tier,
          metadata_json: metadataJson,
          updated_at: trx.fn.now(),
        });

      const usage = await trx<UsageRow>('workflow_step_usage_periods')
        .where({ tenant: summary.tenant, period_start: summary.periodStart, period_end: summary.periodEnd })
        .forUpdate()
        .first();

      if (!usage) {
        throw new Error('workflow_step_usage_periods row missing after upsert');
      }

      if (usage.effective_limit != null && usage.used_count >= usage.effective_limit) {
        logger.warn('[WorkflowStepQuotaService] Workflow step quota exceeded at reservation', {
          tenant: summary.tenant,
          periodStart: summary.periodStart,
          periodEnd: summary.periodEnd,
          periodSource: summary.periodSource,
          limitSource: summary.limitSource,
          effectiveLimit: usage.effective_limit,
          usedCount: usage.used_count,
        });
        return {
          allowed: false,
          summary: {
            ...summary,
            usedCount: usage.used_count,
            remaining: 0,
          },
        };
      }

      const [updated] = await trx<UsageRow>('workflow_step_usage_periods')
        .where({ tenant: summary.tenant, period_start: summary.periodStart, period_end: summary.periodEnd })
        .update({
          used_count: trx.raw('used_count + 1'),
          updated_at: trx.fn.now(),
        })
        .returning('*');

      const usedCountAfter = updated.used_count;
      logger.debug('[WorkflowStepQuotaService] Reserved workflow step quota', {
        tenant: summary.tenant,
        periodStart: summary.periodStart,
        periodEnd: summary.periodEnd,
        periodSource: summary.periodSource,
        limitSource: summary.limitSource,
        effectiveLimit: updated.effective_limit,
        usedCountAfter,
      });
      return {
        allowed: true,
        usedCountAfter,
        summary: {
          ...summary,
          usedCount: usedCountAfter,
          remaining: updated.effective_limit == null ? null : Math.max(updated.effective_limit - usedCountAfter, 0),
        },
      };
    });
  }

  async reconcileUsagePeriod(
    knex: Knex,
    tenant: string,
    periodStart: string,
    periodEnd: string
  ): Promise<WorkflowStepQuotaReconciliation> {
    const usage = await knex<UsageRow>('workflow_step_usage_periods')
      .where({
        tenant,
        period_start: periodStart,
        period_end: periodEnd,
      })
      .first();

    const ledgerRow = await knex('workflow_run_steps as s')
      .join('workflow_runs as r', 'r.run_id', 's.run_id')
      .where('r.tenant_id', tenant)
      .andWhere('s.started_at', '>=', periodStart)
      .andWhere('s.started_at', '<', periodEnd)
      .count<{ count: string }>('s.step_id as count')
      .first();

    const counterUsedCount = usage?.used_count ?? 0;
    const ledgerStepCount = Number(ledgerRow?.count ?? 0);
    const drift = counterUsedCount - ledgerStepCount;

    return {
      tenant,
      periodStart,
      periodEnd,
      counterUsedCount,
      ledgerStepCount,
      drift,
    };
  }
}

export const workflowStepQuotaService = new WorkflowStepQuotaService();
