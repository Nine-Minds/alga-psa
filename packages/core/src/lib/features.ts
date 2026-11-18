// Check both EDITION (server-side) and NEXT_PUBLIC_EDITION (client-side) for consistency
// EDITION can be 'ee' or 'enterprise', NEXT_PUBLIC_EDITION is always 'enterprise'
export const isEnterprise =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

import { resolveFlagTargeting } from './featureFlagTargeting';

export { flagTargetingEnvName, resolveFlagTargeting } from './featureFlagTargeting';

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

/** Keeps an evaluated false distinct from a fallback used after flag evaluation failed. */
export type FeatureFlagEvaluation =
  | { status: 'evaluated'; enabled: boolean }
  | { status: 'unavailable'; enabled: boolean };

type FeatureFlagChecker = (
  flagKey: string,
  context: FeatureFlagContext,
) => Promise<boolean | FeatureFlagEvaluation>;

const FEATURE_FLAG_CHECKER_KEY = Symbol.for('alga.core.featureFlagChecker');

type FeatureFlagCheckerRegistry = typeof globalThis & {
  [FEATURE_FLAG_CHECKER_KEY]?: FeatureFlagChecker | null;
};

export function registerFeatureFlagChecker(checker: FeatureFlagChecker): void {
  (globalThis as FeatureFlagCheckerRegistry)[FEATURE_FLAG_CHECKER_KEY] = checker;
}

export async function evaluateFeatureFlag(
  flagKey: string,
  context: FeatureFlagContext = {},
): Promise<FeatureFlagEvaluation> {
  // Flag-agnostic tenant targeting (see featureFlagTargeting.ts). Authoritative
  // for a targeted flag, including over the global disable override.
  const targeted = resolveFlagTargeting(flagKey, context.tenantId);
  if (targeted !== null) return { status: 'evaluated', enabled: targeted };

  if (featureFlagsAreDisabled()) {
    return { status: 'evaluated', enabled: true };
  }

  const checker = (globalThis as FeatureFlagCheckerRegistry)[FEATURE_FLAG_CHECKER_KEY];
  if (!checker) return { status: 'unavailable', enabled: false };
  try {
    const result = await checker(flagKey, context);
    if (typeof result === 'boolean') return { status: 'evaluated', enabled: result };
    if (result?.status === 'evaluated' || result?.status === 'unavailable') return result;
    return { status: 'unavailable', enabled: false };
  } catch {
    return { status: 'unavailable', enabled: false };
  }
}

export async function isFeatureFlagEnabled(
  flagKey: string,
  context: FeatureFlagContext = {},
): Promise<boolean> {
  return (await evaluateFeatureFlag(flagKey, context)).enabled;
}
