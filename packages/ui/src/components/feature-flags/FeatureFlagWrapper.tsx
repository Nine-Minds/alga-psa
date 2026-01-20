'use client';

import React from 'react';
import { useFeatureFlag, useFeatureFlags } from '@alga-psa/ui/hooks';
import { FeaturePlaceholder } from './FeaturePlaceholder';

interface FeatureFlagWrapperProps {
  flagKey: string;
  children: React.ReactNode;
  placeholderProps?: {
    featureName: string;
    description?: string;
    estimatedDate?: string;
    icon?: 'construction' | 'wrench' | 'hammer';
  };
  fallback?: React.ReactNode;
  loadingFallback?: React.ReactNode;
}

export function FeatureFlagWrapper({
  flagKey,
  children,
  placeholderProps,
  fallback,
  loadingFallback
}: FeatureFlagWrapperProps) {
  const featureFlag = useFeatureFlag(flagKey);
  const isEnabled = typeof featureFlag === 'boolean' ? featureFlag : featureFlag?.enabled;
  const { flags, loading } = useFeatureFlags();
  
  // Check if feature flags have been loaded
  const isLoading = loading;
  
  if (isLoading && loadingFallback !== undefined) {
    return <>{loadingFallback}</>;
  }

  if (isEnabled) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (placeholderProps) {
    return <FeaturePlaceholder {...placeholderProps} />;
  }

  return null;
}
