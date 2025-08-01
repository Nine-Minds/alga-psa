'use client';

import React from 'react';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import { FeaturePlaceholder } from 'server/src/components/FeaturePlaceholder';

interface ClientBillingWrapperProps {
  children: React.ReactNode;
}

export default function ClientBillingWrapper({ children }: ClientBillingWrapperProps) {
  const featureFlag = useFeatureFlag('billing-enabled');
  const isBillingEnabled = typeof featureFlag === 'boolean' ? featureFlag : featureFlag?.enabled;

  if (!isBillingEnabled) {
    return (
      <div className="flex-1 flex">
        <FeaturePlaceholder />
      </div>
    );
  }

  return <>{children}</>;
}