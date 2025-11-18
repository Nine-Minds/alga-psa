'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePostHog } from 'posthog-js/react';

const FEATURE_FLAG_DISABLE_VALUES = new Set(['true', '1', 'yes', 'on']);
const featureFlagsDisabled =
  typeof process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS === 'string' &&
  FEATURE_FLAG_DISABLE_VALUES.has(
    process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS.toLowerCase()
  );

interface FeatureFlagOptions {
  // Override the user context
  userId?: string;
  // Additional properties for evaluation
  properties?: Record<string, any>;
  // Default value while loading
  defaultValue?: boolean | string;
  // Polling interval in ms (0 to disable)
  pollInterval?: number;
}

/**
 * Hook to check if a feature flag is enabled
 */
export function useFeatureFlag(
  flagKey: string,
  options: FeatureFlagOptions = {}
): {
  enabled: boolean;
  loading: boolean;
  error: Error | null;
} {
  // Safely get session - handle cases where SessionProvider isn't available
  let session = null;
  try {
    const sessionResult = useSession();
    session = sessionResult?.data;
  } catch (error) {
    // SessionProvider not available, continue without session
    console.warn('useSession hook called outside of SessionProvider context');
  }

  const posthog = usePostHog();
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (featureFlagsDisabled) {
      return true;
    }
    return typeof options.defaultValue === 'boolean' ? options.defaultValue : false;
  });
  const [loading, setLoading] = useState(!featureFlagsDisabled);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (featureFlagsDisabled) {
      setEnabled(true);
      setLoading(false);
      setError(null);
      return;
    }

    if (!posthog) {
      setLoading(false);
      return;
    }

    const checkFlag = async () => {
      try {
        setLoading(true);
        setError(null);

        const userId = options.userId || session?.user?.id;
        const distinctId = userId || 'anonymous';

        // Wait a bit for PostHog to be ready if just initialized
        if (posthog.isFeatureEnabled === undefined) {
          console.warn(`[FeatureFlag] PostHog not ready yet for ${flagKey}`);
          setTimeout(() => checkFlag(), 100);
          return;
        }

        // Get feature flag value from PostHog
        const flagValue = posthog.isFeatureEnabled(flagKey);
        
        // Debug logging in development
        if (process.env.NODE_ENV === 'development') {
          console.log(`[FeatureFlag] ${flagKey}:`, {
            flagValue,
            userId,
            distinctId,
            tenant: session?.user?.tenant,
            session: session?.user
          });
        }
        
        // PostHog React SDK returns boolean directly
        setEnabled(!!flagValue);
      } catch (err) {
        console.error(`Error checking feature flag ${flagKey}:`, err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setEnabled(false);
      } finally {
        setLoading(false);
      }
    };

    // Add a small delay to ensure PostHog has identified the user
    const timeoutId = setTimeout(() => {
      checkFlag();
    }, 200);

    // Set up polling if requested
    if (options.pollInterval && options.pollInterval > 0) {
      const interval = setInterval(checkFlag, options.pollInterval);
      return () => {
        clearTimeout(timeoutId);
        clearInterval(interval);
      };
    }
    
    return () => clearTimeout(timeoutId);
  }, [
    posthog,
    flagKey,
    session?.user?.id,
    session?.user?.tenant,
    options.userId,
    options.pollInterval,
  ]);

  return { enabled, loading, error };
}

/**
 * Hook to get a feature flag variant (for A/B testing)
 */
export function useFeatureFlagVariant(
  flagKey: string,
  options: FeatureFlagOptions = {}
): {
  variant: string | null;
  loading: boolean;
  error: Error | null;
} {
  const { data: session } = useSession();
  const posthog = usePostHog();
  const [variant, setVariant] = useState<string | null>(
    typeof options.defaultValue === 'string' ? options.defaultValue : null
  );
  const [loading, setLoading] = useState(!featureFlagsDisabled);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (featureFlagsDisabled) {
      setVariant(typeof options.defaultValue === 'string' ? options.defaultValue : null);
      setLoading(false);
      setError(null);
      return;
    }

    if (!posthog) {
      setLoading(false);
      return;
    }

    const checkVariant = async () => {
      try {
        setLoading(true);
        setError(null);

        const userId = options.userId || session?.user?.id;
        const distinctId = userId || 'anonymous';

        // Get feature flag variant from PostHog
        const flagValue = posthog.getFeatureFlag(flagKey);
        
        // Convert to string if it's not null/undefined
        setVariant(flagValue ? String(flagValue) : null);
      } catch (err) {
        console.error(`Error checking feature flag variant ${flagKey}:`, err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setVariant(null);
      } finally {
        setLoading(false);
      }
    };

    checkVariant();

    // Set up polling if requested
    if (options.pollInterval && options.pollInterval > 0) {
      const interval = setInterval(checkVariant, options.pollInterval);
      return () => clearInterval(interval);
    }
  }, [posthog, flagKey, session?.user?.id, options.userId, options.pollInterval]);

  return { variant, loading, error };
}

/**
 * Hook to get all feature flags
 */
export function useFeatureFlags(): {
  flags: Record<string, boolean | string>;
  loading: boolean;
  error: Error | null;
} {
  const posthog = usePostHog();
  const [flags, setFlags] = useState<Record<string, boolean | string>>({});
  const [loading, setLoading] = useState(!featureFlagsDisabled);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (featureFlagsDisabled) {
      setFlags({});
      setLoading(false);
      setError(null);
      return;
    }

    if (!posthog) {
      setLoading(false);
      return;
    }

    try {
      // Get all feature flags from PostHog
      const allFlags = posthog.featureFlags || {};
      setFlags(allFlags as unknown as Record<string, string | boolean>);
      setLoading(false);
    } catch (err) {
      console.error('Error getting all feature flags:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
      setLoading(false);
    }
  }, [posthog]);

  return { flags, loading, error };
}

/**
 * Component to conditionally render based on feature flag
 */
export function FeatureFlag({
  flag,
  children,
  fallback = null,
  loadingComponent = null,
}: {
  flag: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  loadingComponent?: React.ReactNode;
}) {
  const { enabled, loading } = useFeatureFlag(flag);

  if (loading && loadingComponent) {
    return <>{loadingComponent}</>;
  }

  return <>{enabled ? children : fallback}</>;
}

/**
 * Component to render different variants based on feature flag
 */
export function FeatureFlagVariant({
  flag,
  variants,
  defaultVariant = 'control',
  loadingComponent = null,
}: {
  flag: string;
  variants: Record<string, React.ReactNode>;
  defaultVariant?: string;
  loadingComponent?: React.ReactNode;
}) {
  const { variant, loading } = useFeatureFlagVariant(flag);

  if (loading && loadingComponent) {
    return <>{loadingComponent}</>;
  }

  const selectedVariant = variant || defaultVariant;
  return <>{variants[selectedVariant] || variants[defaultVariant] || null}</>;
}
