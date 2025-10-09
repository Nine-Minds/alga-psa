'use client'

import React from 'react';
import CustomTabs, { TabContent } from "server/src/components/ui/CustomTabs";
import NumberingSettings from 'server/src/components/settings/general/NumberingSettings';
import ZeroDollarInvoiceSettings from './ZeroDollarInvoiceSettings';
import CreditExpirationSettings from './CreditExpirationSettings';
import ServiceTypeSettings from './ServiceTypeSettings';
import ServiceCategoriesSettings from './ServiceCategoriesSettings';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import { FeaturePlaceholder } from 'server/src/components/FeaturePlaceholder';

const BillingSettings: React.FC = () => {
  const featureFlag = useFeatureFlag('billing-enabled');
  const isBillingEnabled = typeof featureFlag === 'boolean' ? featureFlag : featureFlag?.enabled;
  
  const tabContent: TabContent[] = [
    {
      label: "Service Types",
      content: <ServiceTypeSettings />,
    },
    {
      label: "Invoice Settings",
      content: isBillingEnabled ? (
        <div className="space-y-6">
          <NumberingSettings entityType="INVOICE" />
          <ZeroDollarInvoiceSettings />
          <CreditExpirationSettings />
        </div>
      ) : (
        <FeaturePlaceholder />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <CustomTabs tabs={tabContent} defaultTab="Service Types" />
    </div>
  );
};

export default BillingSettings;