'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type FeatureFlagValue = boolean | string;
export type FeatureFlagBootstrap = Record<string, FeatureFlagValue>;

/**
 * Server-evaluated flag and capability values handed to the browser by the root
 * layout (`PostHogProvider initialFeatureFlags`). Extracted from
 * useFeatureFlag so `useCapability` can read it without importing posthog-js.
 */
const FeatureFlagBootstrapContext = createContext<FeatureFlagBootstrap>({});

export function FeatureFlagBootstrapProvider({
  children,
  initialFeatureFlags,
}: {
  children: ReactNode;
  initialFeatureFlags: FeatureFlagBootstrap;
}) {
  return (
    <FeatureFlagBootstrapContext.Provider value={initialFeatureFlags}>
      {children}
    </FeatureFlagBootstrapContext.Provider>
  );
}

export function useFeatureFlagBootstrap(): FeatureFlagBootstrap {
  return useContext(FeatureFlagBootstrapContext);
}
