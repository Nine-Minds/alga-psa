'use client'

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import Spinner from '@alga-psa/ui/components/Spinner';
import CustomTabs, { TabContent } from '@alga-psa/ui/components/CustomTabs';
import { NumberingSettings } from '@alga-psa/reference-data/components';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import DefaultCurrencySettings from './DefaultCurrencySettings';
import ZeroDollarInvoiceSettings from './ZeroDollarInvoiceSettings';
import CreditExpirationSettings from './CreditExpirationSettings';
import RenewalAutomationSettings from './RenewalAutomationSettings';
import { TaxSourceSettings } from '../tax/TaxSourceSettings';
import { TaxRegionsManager } from '../tax/TaxRegionsManager';

// Payment Settings Skeleton Component
const PaymentSettingsSkeleton: React.FC = () => {
  const { t } = useTranslation('msp/billing-settings');

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
        <p className="mt-2 text-muted-foreground">
          {t('payments.loading', { defaultValue: 'Loading payment settings...' })}
        </p>
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

const DEFAULT_BILLING_SECTION = 'general';

const BillingSettings: React.FC = () => {
  const { t } = useTranslation('msp/billing-settings');
  const searchParams = useSearchParams();
  const sectionParam = searchParams?.get('section');
  const { enabled: isQuotingEnabled } = useFeatureFlag('quoting-enabled', { defaultValue: false });

  const billingSectionIds: readonly string[] = isQuotingEnabled
    ? ['general', 'quoting', 'tax', 'payments']
    : ['general', 'tax', 'payments'];

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const requestedTab = sectionParam?.toLowerCase();
    return requestedTab && billingSectionIds.includes(requestedTab)
      ? requestedTab
      : DEFAULT_BILLING_SECTION;
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const requestedTab = sectionParam?.toLowerCase();
    const targetTab = requestedTab && billingSectionIds.includes(requestedTab)
      ? requestedTab
      : DEFAULT_BILLING_SECTION;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [sectionParam, activeTab, billingSectionIds]);

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
      label: t('tabs.general', { defaultValue: 'General' }),
      content: (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('general.currency.title', { defaultValue: 'Default Currency' })}</CardTitle>
              <CardDescription>
                {t('general.currency.description', {
                  defaultValue: 'Set the default currency for new products, services, contracts, and quotes. This can be overridden per client in their billing configuration.'
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DefaultCurrencySettings />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('general.invoiceNumbering.title', { defaultValue: 'Invoice Numbering' })}</CardTitle>
              <CardDescription>
                {t('general.invoiceNumbering.description', {
                  defaultValue: 'Customize how invoice numbers are generated and displayed.'
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NumberingSettings entityType="INVOICE" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('general.zeroDollar.title', { defaultValue: 'Zero-Dollar Invoices' })}</CardTitle>
              <CardDescription>
                {t('general.zeroDollar.description', {
                  defaultValue: 'Control how invoices with no charges are handled.'
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ZeroDollarInvoiceSettings />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('general.creditExpiration.title', { defaultValue: 'Credit Expiration' })}</CardTitle>
              <CardDescription>
                {t('general.creditExpiration.description', {
                  defaultValue: 'Configure when and how client credits expire.'
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreditExpirationSettings />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('general.renewal.title', { defaultValue: 'Renewal Automation' })}</CardTitle>
              <CardDescription>
                {t('general.renewal.description', {
                  defaultValue: 'Configure default behavior when contracts reach their renewal date.'
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RenewalAutomationSettings />
            </CardContent>
          </Card>
        </div>
      ),
    },
    ...(isQuotingEnabled ? [{
      id: 'quoting',
      label: t('tabs.quoting', { defaultValue: 'Quoting' }),
      content: (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('quoting.quoteNumbering.title', { defaultValue: 'Quote Numbering' })}</CardTitle>
              <CardDescription>
                {t('quoting.quoteNumbering.description', {
                  defaultValue: 'Customize how quote numbers are generated and displayed.'
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NumberingSettings entityType="QUOTE" />
            </CardContent>
          </Card>
        </div>
      ),
    }] : []),
    {
      id: 'tax',
      label: t('tabs.tax', { defaultValue: 'Tax' }),
      content: (
        <div className="space-y-6">
          <TaxSourceSettings />
          <Card>
            <CardHeader>
              <CardTitle>{t('tax.taxRegions.title', { defaultValue: 'Tax Regions' })}</CardTitle>
              <CardDescription>
                {t('tax.taxRegions.description', {
                  defaultValue: 'Manage tax regions and related settings'
                })}
              </CardDescription>
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
      label: t('tabs.payments', { defaultValue: 'Payments' }),
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('payments.title', { defaultValue: 'Payment Settings' })}</CardTitle>
            <CardDescription>
              {t('payments.description', {
                defaultValue: 'Configure how payment links work with your invoices.'
              })}
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
