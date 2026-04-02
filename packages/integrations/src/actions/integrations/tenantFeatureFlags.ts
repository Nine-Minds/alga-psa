/* global process */

import {
  isFeatureFlagEnabled,
  type FeatureFlagContext,
} from '@alga-psa/core';

type ServerFeatureFlagsModule = {
  featureFlags: {
    isEnabled: (flagKey: string, context?: FeatureFlagContext) => Promise<boolean>;
  };
};

/**
 * Server actions can run in an isolated module context before the app-level
 * checker registration has executed. Retry against the server-local feature
 * flag runtime to avoid false negatives in that case.
 */
export async function evaluateTenantFeatureFlag(
  flagKey: string,
  context: FeatureFlagContext = {}
): Promise<boolean> {
  const enabled = await isFeatureFlagEnabled(flagKey, context);
  if (enabled || process.env.NODE_ENV === 'test') {
    return enabled;
  }

  try {
    const { featureFlags } = (await import(
      'server/src/lib/feature-flags/featureFlags'
    )) as ServerFeatureFlagsModule;
    return featureFlags.isEnabled(flagKey, context);
  } catch {
    return enabled;
  }
}
