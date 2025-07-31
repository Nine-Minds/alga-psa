'use client';

import React from 'react';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { FeaturePlaceholder } from '../FeaturePlaceholder';

interface BillingPageWrapperProps {
  children: React.ReactNode;
}

export default function BillingPageWrapper({ children }: BillingPageWrapperProps) {
  const featureFlag = useFeatureFlag('billing-enabled');
  const isBillingEnabled = typeof featureFlag === 'boolean' ? featureFlag : featureFlag?.enabled;
  
  // Debug logging
  if (typeof window !== 'undefined') {
    console.log('BillingPageWrapper - Feature flag response:', featureFlag);
    console.log('BillingPageWrapper - Is billing enabled:', isBillingEnabled);
  }

  if (!isBillingEnabled) {
    return (
      <div className="flex-1 flex">
        <FeaturePlaceholder />
      </div>
    );
  }

  return <>{children}</>;
}