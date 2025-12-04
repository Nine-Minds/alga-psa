'use client'

import React from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import Spinner from 'server/src/components/ui/Spinner';
import CustomTabs, { TabContent } from 'server/src/components/ui/CustomTabs';
import NumberingSettings from 'server/src/components/settings/general/NumberingSettings';
import ZeroDollarInvoiceSettings from './ZeroDollarInvoiceSettings';
import CreditExpirationSettings from './CreditExpirationSettings';
import { TaxSourceSettings } from 'server/src/components/settings/tax/TaxSourceSettings';
import { TaxRegionsManager } from 'server/src/components/settings/tax/TaxRegionsManager';

// Payment Settings Skeleton Component
const PaymentSettingsSkeleton: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Skeleton className="h-6 w-40" />
        </CardTitle>
        <div className="text-sm text-muted-foreground mt-2">
          <Skeleton className="h-4 w-64" />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Connection Status Skeleton */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-10 w-24" />
          </div>
        </div>

        {/* Form Fields Skeleton */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>

        {/* Loading Indicator */}
        <div className="flex flex-col items-center justify-center py-8">
          <Spinner size="md" />
          <p className="mt-2 text-gray-600">Loading payment configuration...</p>
        </div>
      </CardContent>
    </Card>
  );
};

// Dynamically import PaymentSettings (EE feature)
const PaymentSettings = dynamic(
  () => import('@ee/components/settings/billing/PaymentSettings'),
  {
    loading: () => <PaymentSettingsSkeleton />,
    ssr: false,
  }
);

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
    {
      label: 'Payment Settings',
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Payment Settings</CardTitle>
            <CardDescription>
              Configure payment providers (Stripe) for invoice payments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentSettings />
          </CardContent>
        </Card>
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