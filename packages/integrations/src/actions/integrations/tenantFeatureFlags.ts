/* global process */

import {
  isFeatureFlagEnabled,
  type FeatureFlagContext,
} from '@alga-psa/core';
import { FeatureFlags } from '@alga-psa/core/server';

const fallbackFeatureFlags = new FeatureFlags();

/**
 * Server actions can run in an isolated module context before the app-level
 * checker registration has executed. Retry against the shared server-side
 * feature flag runtime to avoid false negatives in that case.
 */
export async function evaluateTenantFeatureFlag(
  flagKey: string,
  context: FeatureFlagContext = {}
): Promise<boolean> {
  const enabled = await isFeatureFlagEnabled(flagKey, context);
  if (enabled || process.env.NODE_ENV === 'test') {
    return enabled;
  }

  return fallbackFeatureFlags.isEnabled(flagKey, context);
}
