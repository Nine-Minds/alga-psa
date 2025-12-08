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
    <div className="space-y-6">
      {/* Form Fields Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-6 w-12" />
      </div>
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-6 w-12" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-48" />
      </div>

      {/* Loading Indicator */}
      <div className="flex flex-col items-center justify-center py-4">
        <Spinner size="md" />
        <p className="mt-2 text-gray-600">Loading payment settings...</p>
      </div>
    </div>
  );
};

// Dynamic import for PaymentSettingsConfig using the packages pattern
// The webpack alias @product/billing/entry will resolve to either EE or OSS version
const PaymentSettingsConfig = dynamic(
  () => import('@product/billing/entry').then(mod => {
    const PaymentSettingsConfigExport = mod.PaymentSettingsConfig;
    const result = PaymentSettingsConfigExport();

    // EE version: result is a Promise that resolves to the module
    // OSS version: result is JSX directly
    if (result instanceof Promise || (result && typeof result === 'object' && 'then' in result && typeof (result as any).then === 'function')) {
      // EE: unwrap the promise and get the component
      return (result as unknown as Promise<any>).then(componentModule => ({
        default: componentModule.default || componentModule.PaymentSettingsConfig || componentModule
      }));
    } else {
      // OSS: result is JSX, wrap it in a component function
      return Promise.resolve({ default: () => result });
    }
  }),
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
      label: 'Payments',
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Payment Settings</CardTitle>
            <CardDescription>
              Configure how payment links work with your invoices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentSettingsConfig />
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