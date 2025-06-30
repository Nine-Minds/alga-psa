'use client'

import React from 'react';
import CustomTabs, { TabContent } from "server/src/components/ui/CustomTabs";
import NumberingSettings from '../general/NumberingSettings';
import ZeroDollarInvoiceSettings from './ZeroDollarInvoiceSettings';
import CreditExpirationSettings from './CreditExpirationSettings';
import ServiceTypeSettings from './ServiceTypeSettings';
import ServiceCategoriesSettings from './ServiceCategoriesSettings';

const BillingSettings: React.FC = () => {
  const tabContent: TabContent[] = [
    {
      label: "Invoice Settings",
      content: (
        <div className="space-y-6">
          <NumberingSettings entityType="INVOICE" />
          <ZeroDollarInvoiceSettings />
          <CreditExpirationSettings />
        </div>
      ),
    },
    {
      label: "Service Types",
      content: <ServiceTypeSettings />,
    },
    {
      label: "Service Categories",
      content: <ServiceCategoriesSettings />,
    },
  ];

  return (
    <div className="space-y-6">
      <CustomTabs tabs={tabContent} defaultTab="Invoice Settings" />
    </div>
  );
};

export default BillingSettings;