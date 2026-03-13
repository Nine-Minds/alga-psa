import {
  FeatureFlags,
  type FeatureFlagContext,
  type FeatureFlagEvaluationEvent,
  type FeatureFlagVariantAssignmentEvent,
  type FeatureFlagVariant,
} from '@alga-psa/core/server';
import { analytics } from '../analytics/posthog';
import { createTenantKnex } from '../db';
async function enrichProperties(context: FeatureFlagContext): Promise<Record<string, unknown>> {
  if (!context.tenantId) {
    return {};
  }

  try {
    const { knex } = await createTenantKnex();
    const tenantInfo = await knex('tenants')
      .where({ tenant: context.tenantId })
      .first();

    if (!tenantInfo) {
      return {};
    }

    return {
      tenant_created_at: tenantInfo.created_at,
      tenant_status: tenantInfo.status,
    };
  } catch {
    return {};
  }
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
