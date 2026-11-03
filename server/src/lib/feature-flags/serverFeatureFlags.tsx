import { featureFlags, FeatureFlagContext } from './featureFlags';
import { cache } from 'react';
import React from 'react';
import { getSession } from '@alga-psa/auth';

/**
 * Server-side feature flag check with caching
 * Uses React's cache to deduplicate requests within a single request
 */
export const checkFeatureFlag = cache(async (
  flagKey: string,
  context?: Partial<FeatureFlagContext>
): Promise<boolean> => {
  try {
    // Get session for user context
    const session = await getSession();
    
    const fullContext: FeatureFlagContext = {
      userId: session?.user?.id,
      tenantId: session?.user?.tenant,
      ...context,
    };

    return await featureFlags.isEnabled(flagKey, fullContext);
  } catch (error) {
    console.error(`Error checking feature flag ${flagKey}:`, error);
    return false;
  }
});

/**
 * Server-side feature flag variant check with caching
 */
export const getFeatureFlagVariant = cache(async (
  flagKey: string,
  context?: Partial<FeatureFlagContext>
): Promise<string | null> => {
  try {
    const session = await getSession();
    
    const fullContext: FeatureFlagContext = {
      userId: session?.user?.id,
      tenantId: session?.user?.tenant,
      ...context,
    };

    return await featureFlags.getVariant(flagKey, fullContext);
  } catch (error) {
    console.error(`Error getting feature flag variant ${flagKey}:`, error);
    return null;
  }
});

/**
 * Server-side check for multiple feature flags
 */
export const checkFeatureFlags = cache(async (
  flagKeys: string[],
  context?: Partial<FeatureFlagContext>
): Promise<Record<string, boolean>> => {
  const results: Record<string, boolean> = {};
  
  // Check flags in parallel
  await Promise.all(
    flagKeys.map(async (key) => {
      results[key] = await checkFeatureFlag(key, context);
    })
  );
  
  return results;
});

/**
 * Server component wrapper for feature flags
 */
export async function ServerFeatureFlag({
  flag,
  children,
  fallback = null,
  context,
}: {
  flag: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  context?: Partial<FeatureFlagContext>;
}) {
  const enabled = await checkFeatureFlag(flag, context);
  return <>{enabled ? children : fallback}</>;
}

/**
 * Server component wrapper for feature flag variants
 */
export async function ServerFeatureFlagVariant({
  flag,
  variants,
  defaultVariant = 'control',
  context,
}: {
  flag: string;
  variants: Record<string, React.ReactNode>;
  defaultVariant?: string;
  context?: Partial<FeatureFlagContext>;
}) {
  const variant = await getFeatureFlagVariant(flag, context);
  const selectedVariant = variant || defaultVariant;
  return <>{variants[selectedVariant] || variants[defaultVariant] || null}</>;
}
