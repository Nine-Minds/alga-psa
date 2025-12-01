'use client'

import React from 'react';
import dynamic from 'next/dynamic';
import { Hash, DollarSign, Clock, CreditCard } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import Spinner from 'server/src/components/ui/Spinner';
import CustomTabs, { TabContent } from 'server/src/components/ui/CustomTabs';
import NumberingSettings from 'server/src/components/settings/general/NumberingSettings';
import ZeroDollarInvoiceSettings from './ZeroDollarInvoiceSettings';
import CreditExpirationSettings from './CreditExpirationSettings';

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
  const tabs: TabContent[] = [
    {
      label: 'Invoice Numbering',
      icon: <Hash className="w-4 h-4" />,
      content: (
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
      ),
    },
    {
      label: 'Zero Dollar Invoices',
      icon: <DollarSign className="w-4 h-4" />,
      content: <ZeroDollarInvoiceSettings />,
    },
    {
      label: 'Credit Expiration',
      icon: <Clock className="w-4 h-4" />,
      content: <CreditExpirationSettings />,
    },
    {
      label: 'Payment Settings',
      icon: <CreditCard className="w-4 h-4" />,
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
    <div>
      <CustomTabs tabs={tabs} defaultTab="Invoice Numbering" />
    </div>
  );
};

export default BillingSettings;