// @ts-nocheck
// TODO: getFeatureFlags vs getFeatureFlag typo in PostHog API
'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePostHog } from 'posthog-js/react';

const FEATURE_FLAG_DISABLE_VALUES = new Set(['true', '1', 'yes', 'on']);
const featureFlagsDisabled =
  typeof process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS === 'string' &&
  FEATURE_FLAG_DISABLE_VALUES.has(process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS.toLowerCase());

const FEATURE_FLAG_TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FEATURE_FLAG_FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

function parseForcedFeatureFlags(raw: string | undefined): Record<string, boolean | string> {
  if (typeof raw !== 'string' || raw.trim().length === 0) return {};

  // Format: "flag-a:true,flag-b:false,flag-c:variant"
  const out: Record<string, boolean | string> = {};
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;

    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx).trim();
    const valueRaw = trimmed.slice(idx + 1).trim();
    if (!key) continue;

    const lower = valueRaw.toLowerCase();
    if (FEATURE_FLAG_TRUE_VALUES.has(lower)) {
      out[key] = true;
    } else if (FEATURE_FLAG_FALSE_VALUES.has(lower)) {
      out[key] = false;
    } else {
      out[key] = valueRaw;
    }
  }
  return out;
}

const forcedFeatureFlags = parseForcedFeatureFlags(process.env.NEXT_PUBLIC_FORCE_FEATURE_FLAGS);

function getForcedFlagValue(flagKey: string): boolean | string | undefined {
  return Object.prototype.hasOwnProperty.call(forcedFeatureFlags, flagKey) ? forcedFeatureFlags[flagKey] : undefined;
}

function coerceForcedBoolean(flagKey: string, value: boolean | string): boolean {
  if (typeof value === 'boolean') return value;
  const lower = value.toLowerCase();
  if (FEATURE_FLAG_TRUE_VALUES.has(lower)) return true;
  if (FEATURE_FLAG_FALSE_VALUES.has(lower)) return false;
  console.warn(`[FeatureFlag] Forced flag value for ${flagKey} is not boolean-like (${value}); treating as enabled`);
  return true;
}

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
  const forcedValue = getForcedFlagValue(flagKey);
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (featureFlagsDisabled) return true;
    if (forcedValue !== undefined) return coerceForcedBoolean(flagKey, forcedValue);
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

    if (forcedValue !== undefined) {
      setEnabled(coerceForcedBoolean(flagKey, forcedValue));
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
  }, [posthog, flagKey, session?.user?.id, session?.user?.tenant, options.userId, options.pollInterval, forcedValue]);

  return { enabled, loading, error };
}

export function useFeatureFlagVariant(
  flagKey: string,
  options: FeatureFlagOptions = {}
): { variant: string | null; loading: boolean; error: Error | null } {
  const { data: session } = useSession();
  const posthog = usePostHog();
  const forcedValue = getForcedFlagValue(flagKey);
  const [variant, setVariant] = useState<string | null>(
    forcedValue !== undefined
      ? String(forcedValue)
      : typeof options.defaultValue === 'string'
        ? options.defaultValue
        : null
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

    if (forcedValue !== undefined) {
      setVariant(String(forcedValue));
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
  }, [posthog, flagKey, session?.user?.id, options.userId, options.pollInterval, options.defaultValue, forcedValue]);

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

    if (Object.keys(forcedFeatureFlags).length > 0) {
      setFlags(forcedFeatureFlags);
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
