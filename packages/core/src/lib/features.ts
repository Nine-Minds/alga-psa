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

const FEATURE_FLAG_CHECKER_KEY = Symbol.for('alga.core.featureFlagChecker');

type FeatureFlagCheckerRegistry = typeof globalThis & {
  [FEATURE_FLAG_CHECKER_KEY]?: FeatureFlagChecker | null;
};

export function registerFeatureFlagChecker(checker: FeatureFlagChecker): void {
  (globalThis as FeatureFlagCheckerRegistry)[FEATURE_FLAG_CHECKER_KEY] = checker;
}

export async function isFeatureFlagEnabled(
  flagKey: string,
  context: FeatureFlagContext = {},
): Promise<boolean> {
  // Runtime server targeting shared by admission, the probe and RSC bootstrap.
  // An absent allowlist leaves PostHog in charge. A configured allowlist is
  // authoritative (including empty => off), so control tenants stay closed.
  // This changes only the release flag; capability eligibility still applies.
  if (typeof window === 'undefined' && flagKey === 'release-v2-0-feature') {
    const raw = process.env.RELEASE_V2_0_FEATURE_TENANTS;
    if (raw !== undefined) {
      const tenants = raw.split(',').map((id) => id.trim().toLowerCase());
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      // Reject the entire malformed configuration rather than partially
      // enabling a release. No wildcard or user-supplied identity is accepted.
      if (!context.tenantId || tenants.some((id) => !uuid.test(id))) return false;
      return tenants.includes(context.tenantId.toLowerCase());
    }
  }

  if (featureFlagsAreDisabled()) {
    return true;
  }

  const checker = (globalThis as FeatureFlagCheckerRegistry)[FEATURE_FLAG_CHECKER_KEY];
  if (!checker) return false;
  return checker(flagKey, context);
}
