// Check both EDITION (server-side) and NEXT_PUBLIC_EDITION (client-side) for consistency
// EDITION can be 'ee' or 'enterprise', NEXT_PUBLIC_EDITION is always 'enterprise'
import {
  featureFlags,
  featureFlagsAreDisabled,
  type FeatureFlagContext,
  type FeatureFlagEvaluationEvent,
  FeatureFlags,
  type FeatureFlagsOptions,
  type FeatureFlagVariant,
  type FeatureFlagVariantAssignmentEvent,
} from './featureFlagRuntime';

export const isEnterprise =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

export function getFeatureImplementation<T>(ceModule: T, eeModule?: T): T {
  if (isEnterprise && eeModule) {
    return eeModule;
  }
  return ceModule;
}

// ---------------------------------------------------------------------------
// Feature-flag registry override.
//
// Packages call `isFeatureFlagEnabled()` from here. `packages/core` now owns
// the default PostHog-backed runtime, and the server can still register a
// richer checker override during startup when it wants analytics and extra
// tenant properties.
// ---------------------------------------------------------------------------

type FeatureFlagChecker = (
  flagKey: string,
  context: FeatureFlagContext,
) => Promise<boolean>;

let _checker: FeatureFlagChecker | null = null;

export function registerFeatureFlagChecker(checker: FeatureFlagChecker): void {
  _checker = checker;
}

export async function isFeatureFlagEnabled(
  flagKey: string,
  context: FeatureFlagContext = {},
): Promise<boolean> {
  if (featureFlagsAreDisabled()) {
    return true;
  }

  return (_checker ?? featureFlags.isEnabled.bind(featureFlags))(flagKey, context);
}

export {
  featureFlags,
  featureFlagsAreDisabled,
  FeatureFlags,
  type FeatureFlagContext,
  type FeatureFlagEvaluationEvent,
  type FeatureFlagsOptions,
  type FeatureFlagVariant,
  type FeatureFlagVariantAssignmentEvent,
};
