'use client';

import React from 'react';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import { FeaturePlaceholder } from '../FeaturePlaceholder';

interface SystemMonitoringWrapperProps {
  children: React.ReactNode;
}

export default function SystemMonitoringWrapper({ children }: SystemMonitoringWrapperProps) {
  const featureFlag = useFeatureFlag('advanced-features-enabled');
  const isEnabled = typeof featureFlag === 'boolean' ? featureFlag : featureFlag?.enabled;

  if (!isEnabled) {
    return <FeaturePlaceholder />;
  }

  return <>{children}</>;
}