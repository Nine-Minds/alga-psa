'use client'

import React from 'react';
import NumberingSettings from 'server/src/components/settings/general/NumberingSettings';
import ZeroDollarInvoiceSettings from './ZeroDollarInvoiceSettings';
import CreditExpirationSettings from './CreditExpirationSettings';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import { FeaturePlaceholder } from 'server/src/components/FeaturePlaceholder';

const BillingSettings: React.FC = () => {
  const featureFlag = useFeatureFlag('billing-enabled');
  const isBillingEnabled = typeof featureFlag === 'boolean' ? featureFlag : featureFlag?.enabled;

  return (
    <div className="space-y-6">
      {isBillingEnabled ? (
        <>
          <NumberingSettings entityType="INVOICE" />
          <ZeroDollarInvoiceSettings />
          <CreditExpirationSettings />
        </>
      ) : (
        <FeaturePlaceholder />
      )}
    </div>
  );
};

export default BillingSettings;