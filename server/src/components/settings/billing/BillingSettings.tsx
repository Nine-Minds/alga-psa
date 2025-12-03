'use client'

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import CustomTabs, { TabContent } from 'server/src/components/ui/CustomTabs';
import NumberingSettings from 'server/src/components/settings/general/NumberingSettings';
import ZeroDollarInvoiceSettings from './ZeroDollarInvoiceSettings';
import CreditExpirationSettings from './CreditExpirationSettings';
import { TaxSourceSettings } from 'server/src/components/settings/tax/TaxSourceSettings';
import { TaxRegionsManager } from 'server/src/components/settings/tax/TaxRegionsManager';

const BillingSettings: React.FC = () => {
  const tabContent: TabContent[] = [
    {
      label: 'General',
      content: (
        <div className="space-y-6">
          {/* Invoice Numbering Card */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice Numbering</CardTitle>
              <CardDescription>
                Customize how invoice numbers are generated and displayed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NumberingSettings entityType="INVOICE" />
            </CardContent>
          </Card>

          <ZeroDollarInvoiceSettings />
          <CreditExpirationSettings />
        </div>
      ),
    },
    {
      label: 'Tax',
      content: (
        <div className="space-y-6">
          <TaxSourceSettings />
          <Card>
            <CardHeader>
              <CardTitle>Tax Regions</CardTitle>
              <CardDescription>Manage tax regions and related settings</CardDescription>
            </CardHeader>
            <CardContent>
              <TaxRegionsManager />
            </CardContent>
          </Card>
        </div>
      ),
    },
  ];

  return (
    <CustomTabs
      tabs={tabContent}
      defaultTab="General"
      orientation="horizontal"
    />
  );
};

export default BillingSettings;