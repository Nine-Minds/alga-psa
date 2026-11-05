import {
  FeatureFlags,
  type FeatureFlagContext,
  type FeatureFlagEvaluationEvent,
  type FeatureFlagVariantAssignmentEvent,
  type FeatureFlagVariant,
} from '@alga-psa/core/server';
import { analytics } from '../analytics/posthog';
import { createTenantKnex } from '../db';
import { tenantDb } from '@alga-psa/db';
/**
 * Tenant person-properties for server-side flag evaluation (`tenant_created_at`,
 * `tenant_status`). Every server flag evaluation for a tenant (including the
 * root-layout bootstrap, on every request) needs them, so the `tenants` read is
 * cached per tenant for TENANT_FLAG_PROPERTIES_TTL_MS and concurrent misses
 * share one in-flight read: at most one SELECT per tenant per TTL per process,
 * however many flags or requests ask. A failed or empty read is not cached.
 * `created_at` never changes; a `status` change reaches flag targeting within
 * one TTL.
 */
export const TENANT_FLAG_PROPERTIES_TTL_MS = 5 * 60_000;

const tenantFlagProperties = new Map<string, { expiresAt: number; value: Promise<Record<string, unknown>> }>();

async function loadTenantFlagProperties(tenantId: string): Promise<Record<string, unknown> | null> {
  try {
    const { knex } = await createTenantKnex(tenantId);
    const tenantInfo = await tenantDb(knex, tenantId).table('tenants').first();
    if (!tenantInfo) return null;
    return {
      tenant_created_at: tenantInfo.created_at,
      tenant_status: tenantInfo.status,
    };
  } catch {
    return null;
  }
}

async function enrichProperties(context: FeatureFlagContext): Promise<Record<string, unknown>> {
  const { tenantId } = context;
  if (!tenantId) {
    return {};
  }

  const now = Date.now();
  const hit = tenantFlagProperties.get(tenantId);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  const value = loadTenantFlagProperties(tenantId).then((properties) => {
    if (properties === null) tenantFlagProperties.delete(tenantId);
    return properties ?? {};
  });
  tenantFlagProperties.set(tenantId, { expiresAt: now + TENANT_FLAG_PROPERTIES_TTL_MS, value });
  return value;
}

/** Tests only. */
export function clearTenantFlagPropertiesCache(): void {
  tenantFlagProperties.clear();
}

function trackFlagEvaluation(event: FeatureFlagEvaluationEvent): void {
  if (!event.context.userId) {
    return;
  }

  analytics.capture('feature_flag_evaluated', {
    flag_key: event.flagKey,
    flag_value: event.flagValue,
    evaluation_context: {
      has_user: !!event.context.userId,
      has_tenant: !!event.context.tenantId,
    },
  }, event.context.userId);
}

function trackVariantAssignment(event: FeatureFlagVariantAssignmentEvent): void {
  if (!event.context.userId) {
    return;
  }

  analytics.capture('feature_flag_variant_assigned', {
    flag_key: event.flagKey,
    variant: event.variant,
    evaluation_context: {
      has_user: !!event.context.userId,
      has_tenant: !!event.context.tenantId,
    },
  }, event.context.userId);
}

export { FeatureFlags, type FeatureFlagContext, type FeatureFlagVariant };

export const featureFlags = new FeatureFlags({
  clientResolver: () => analytics.getClient() ?? undefined,
  enrichProperties,
  onBooleanEvaluation: trackFlagEvaluation,
  onVariantAssignment: trackVariantAssignment,
});
