// Check both EDITION (server-side) and NEXT_PUBLIC_EDITION (client-side) for consistency
// EDITION can be 'ee' or 'enterprise', NEXT_PUBLIC_EDITION is always 'enterprise'
export const isEnterprise =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

const FEATURE_FLAG_DISABLE_VALUES = new Set(['true', '1', 'yes', 'on']);

function featureFlagsAreDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS ?? env.DISABLE_FEATURE_FLAGS;
  if (typeof raw !== 'string') {
    return false;
  }

  return FEATURE_FLAG_DISABLE_VALUES.has(raw.toLowerCase());
}

export function getFeatureImplementation<T>(ceModule: T, eeModule?: T): T {
  if (isEnterprise && eeModule) {
    return eeModule;
  }
  return ceModule;
}

// ---------------------------------------------------------------------------
// Feature-flag registry
//
// Packages that need feature-flag checks (e.g. @alga-psa/integrations,
// @alga-psa/clients) call `isFeatureFlagEnabled` from here.
// The *server* registers the real PostHog-backed implementation at startup
// via `registerFeatureFlagChecker`.
// ---------------------------------------------------------------------------

export interface FeatureFlagContext {
  userId?: string;
  tenantId?: string;
}

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

  if (!_checker) return false;
  return _checker(flagKey, context);
}
