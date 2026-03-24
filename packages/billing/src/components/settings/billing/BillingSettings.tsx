'use client'

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import Spinner from '@alga-psa/ui/components/Spinner';
import CustomTabs, { TabContent } from '@alga-psa/ui/components/CustomTabs';
import { NumberingSettings } from '@alga-psa/reference-data/components';
import ZeroDollarInvoiceSettings from './ZeroDollarInvoiceSettings';
import CreditExpirationSettings from './CreditExpirationSettings';
import RenewalAutomationSettings from './RenewalAutomationSettings';
import { TaxSourceSettings } from '../tax/TaxSourceSettings';
import { TaxRegionsManager } from '../tax/TaxRegionsManager';

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
        <p className="mt-2 text-muted-foreground">Loading payment settings...</p>
      </div>
    </div>
  );
};

// Dynamic import for PaymentSettingsConfig using the packages pattern
// The webpack alias @product/billing/entry will resolve to either EE or OSS version
// Note: @product/billing/entry is a webpack alias resolved at build time, not a real package
const PaymentSettingsConfig = dynamic(
  () => (import('@product/billing/entry') as Promise<any>).then((mod) => {
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

const BILLING_SECTION_IDS = ['general', 'tax', 'payments'] as const;
const DEFAULT_BILLING_SECTION = 'general';

const BillingSettings: React.FC = () => {
  const searchParams = useSearchParams();
  const sectionParam = searchParams?.get('section');

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const requestedTab = sectionParam?.toLowerCase();
    return requestedTab && BILLING_SECTION_IDS.includes(requestedTab as typeof BILLING_SECTION_IDS[number])
      ? requestedTab
      : DEFAULT_BILLING_SECTION;
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const requestedTab = sectionParam?.toLowerCase();
    const targetTab = requestedTab && BILLING_SECTION_IDS.includes(requestedTab as typeof BILLING_SECTION_IDS[number])
      ? requestedTab
      : DEFAULT_BILLING_SECTION;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [sectionParam, activeTab]);

  const updateURL = (tabId: string) => {
    // Build new URL with tab and section parameters
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== DEFAULT_BILLING_SECTION) {
      currentSearchParams.set('section', tabId);
    } else {
      currentSearchParams.delete('section');
    }

    // Keep existing tab parameter
    const newUrl = currentSearchParams.toString()
      ? `/msp/settings?${currentSearchParams.toString()}`
      : '/msp/settings?tab=billing';

    window.history.pushState({}, '', newUrl);
  };

  const tabContent: TabContent[] = [
    {
      id: 'general',
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
          <RenewalAutomationSettings />
        </div>
      ),
    },
    {
      id: 'tax',
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
      id: 'payments',
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
      defaultTab={activeTab}
      orientation="horizontal"
      onTabChange={(tabId) => {
        setActiveTab(tabId);
        updateURL(tabId);
      }}
    />
  );
};

export default BillingSettings;
