'use client';

import React from 'react';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import { FeaturePlaceholder } from './FeaturePlaceholder';

interface FeatureFlagPageWrapperProps {
  children: React.ReactNode;
  featureFlag: string;
}

export default function FeatureFlagPageWrapper({ children, featureFlag }: FeatureFlagPageWrapperProps) {
  const flag = useFeatureFlag(featureFlag);
  const isEnabled = typeof flag === 'boolean' ? flag : flag?.enabled;

  if (!isEnabled) {
    return <FeaturePlaceholder />;
  }

  return <>{children}</>;
}