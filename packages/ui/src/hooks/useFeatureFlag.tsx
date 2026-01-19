'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePostHog } from 'posthog-js/react';

const FEATURE_FLAG_DISABLE_VALUES = new Set(['true', '1', 'yes', 'on']);
const featureFlagsDisabled =
  typeof process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS === 'string' &&
  FEATURE_FLAG_DISABLE_VALUES.has(process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS.toLowerCase());

interface FeatureFlagOptions {
  userId?: string;
  properties?: Record<string, any>;
  defaultValue?: boolean | string;
  pollInterval?: number;
}

export function useFeatureFlag(
  flagKey: string,
  options: FeatureFlagOptions = {}
): { enabled: boolean; loading: boolean; error: Error | null } {
  const { data: session } = useSession();
  const posthog = usePostHog();
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (featureFlagsDisabled) return true;
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
        void distinctId;

        if (posthog.isFeatureEnabled === undefined) {
          console.warn(`[FeatureFlag] PostHog not ready yet for ${flagKey}`);
          setTimeout(() => checkFlag(), 100);
          return;
        }

        const flagValue = posthog.isFeatureEnabled(flagKey);

        if (process.env.NODE_ENV === 'development') {
          console.log(`[FeatureFlag] ${flagKey}:`, {
            flagValue,
            userId,
            distinctId,
            tenant: session?.user?.tenant,
            session: session?.user,
          });
        }

        setEnabled(!!flagValue);
      } catch (err) {
        console.error(`Error checking feature flag ${flagKey}:`, err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
        setEnabled(false);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(() => {
      checkFlag();
    }, 200);

    if (options.pollInterval && options.pollInterval > 0) {
      const interval = setInterval(checkFlag, options.pollInterval);
      return () => {
        clearTimeout(timeoutId);
        clearInterval(interval);
      };
    }

    return () => clearTimeout(timeoutId);
  }, [posthog, flagKey, session?.user?.id, session?.user?.tenant, options.userId, options.pollInterval]);

  return { enabled, loading, error };
}

export function useFeatureFlagVariant(
  flagKey: string,
  options: FeatureFlagOptions = {}
): { variant: string | null; loading: boolean; error: Error | null } {
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
        void distinctId;

        const flagValue = posthog.getFeatureFlag(flagKey);
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

    if (options.pollInterval && options.pollInterval > 0) {
      const interval = setInterval(checkVariant, options.pollInterval);
      return () => clearInterval(interval);
    }
  }, [posthog, flagKey, session?.user?.id, options.userId, options.pollInterval, options.defaultValue]);

  return { variant, loading, error };
}

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
      const allFlags = posthog.getFeatureFlags?.() ?? [];
      const values: Record<string, boolean | string> = {};
      for (const key of allFlags) {
        values[String(key)] = posthog.getFeatureFlag(String(key)) as any;
      }
      setFlags(values);
    } catch (err) {
      console.error('Error getting feature flags:', err);
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [posthog]);

  return { flags, loading, error };
}

