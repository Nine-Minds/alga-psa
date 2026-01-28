'use client';

/**
 * Integrations Settings Page
 *
 * Category-based organization of integrations for better navigation
 * as the number of supported integrations grows.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomTabs, { TabContent } from '@alga-psa/ui/components/CustomTabs';
import {
  Building2,
  Monitor,
  Mail,
  Calendar,
  CreditCard,
  Cloud,
} from 'lucide-react';
import AccountingIntegrationsSetup from './AccountingIntegrationsSetup';
import { EmailProviderConfiguration } from '@alga-psa/integrations/components';
import { CalendarIntegrationsSettings } from '@alga-psa/integrations/components';
import { GoogleIntegrationSettings } from './GoogleIntegrationSettings';
import dynamic from 'next/dynamic';
import Spinner from '@alga-psa/ui/components/Spinner';

// Static import for StripeConnectionSettings using the modular pattern
// The bundler alias @product/billing/entry resolves to EE or OSS version at build time
import { StripeConnectionSettings } from '@product/billing/entry';

// Dynamic import for NinjaOne (EE feature)
const NinjaOneIntegrationSettings = dynamic(
  () => import('@ee/components/settings/integrations/NinjaOneIntegrationSettings'),
  {
    loading: () => (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2">
            <Spinner size="md" />
            <span className="text-sm text-muted-foreground">Loading NinjaOne integration settings...</span>
          </div>
        </CardContent>
      </Card>
    ),
    ssr: false,
  }
);

// Integration category definitions
interface IntegrationCategory {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  integrations: IntegrationItem[];
}

interface IntegrationItem {
  id: string;
  name: string;
  description: string;
  component: React.ComponentType;
  isEE?: boolean;
}

const IntegrationsSettingsPage: React.FC = () => {
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  const searchParams = useSearchParams();
  const categoryParam = searchParams?.get('category');
  
  // Initialize selected category from URL param or default to 'accounting'
  const [selectedCategory, setSelectedCategory] = useState<string>(
    categoryParam && ['accounting', 'rmm', 'communication', 'calendar', 'providers', 'payments'].includes(categoryParam)
      ? categoryParam
      : 'accounting'
  );

  // Update selected category when URL param changes
  useEffect(() => {
    if (categoryParam && ['accounting', 'rmm', 'communication', 'calendar', 'providers', 'payments'].includes(categoryParam)) {
      setSelectedCategory(categoryParam);
    }
  }, [categoryParam]);

  // Define integration categories
  const categories: IntegrationCategory[] = useMemo(() => [
    {
      id: 'accounting',
      label: 'Accounting',
      description: 'Select an accounting package to configure synchronization for invoices, payments, and tax data.',
      icon: Building2,
      integrations: [
        {
          id: 'accounting-setup',
          name: 'Accounting Integrations',
          description: 'Configure accounting synchronization and exports',
          component: AccountingIntegrationsSetup,
        }
      ],
    },
    {
      id: 'rmm',
      label: 'RMM',
      description: 'Connect remote monitoring and management tools',
      icon: Monitor,
      integrations: [
        ...(isEEAvailable ? [{
          id: 'ninjaone',
          name: 'NinjaOne',
          description: 'Sync devices, receive alerts, and enable remote access',
          component: NinjaOneIntegrationSettings,
          isEE: true,
        }] : []),
      ],
    },
    {
      id: 'communication',
      label: 'Communication',
      description: 'Connect email services for ticket processing',
      icon: Mail,
      integrations: [
        {
          id: 'email',
          name: 'Inbound Email',
          description: 'Process incoming emails into tickets',
          component: () => (
            <Card>
              <CardHeader>
                <CardTitle>Inbound Email Integration</CardTitle>
                <CardDescription>
                  Configure email providers to automatically process incoming emails into tickets
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EmailProviderConfiguration />
              </CardContent>
            </Card>
          ),
        },
      ],
    },
    {
      id: 'calendar',
      label: 'Calendar',
      description: 'Connect Google or Outlook calendars to keep dispatch and client appointments aligned',
      icon: Calendar,
      integrations: [
        {
          id: 'calendar-sync',
          name: 'Calendar Sync',
          description: 'Sync schedule entries with Google or Microsoft calendars',
          component: () => (
            <Card>
              <CardHeader>
                <CardTitle>Calendar Integrations</CardTitle>
                <CardDescription>
                  Connect Google Calendar or Microsoft Outlook Calendar to sync schedule entries
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CalendarIntegrationsSettings />
              </CardContent>
            </Card>
          ),
        },
      ],
    },
    {
      id: 'providers',
      label: 'Providers',
      description: 'Configure shared provider credentials used by integrations.',
      icon: Cloud,
      integrations: [
        {
          id: 'google',
          name: 'Google',
          description: 'Tenant-owned Google Cloud credentials for Gmail and Calendar',
          component: () => (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Provider Credentials</CardTitle>
                  <CardDescription>
                    Configure Google first, then connect Google accounts from the Inbound Email and Calendar integration screens.
                  </CardDescription>
                </CardHeader>
              </Card>
              <GoogleIntegrationSettings />
            </div>
          ),
        },
      ],
    },
    {
      id: 'payments',
      label: 'Payments',
      description: 'Accept online payments for invoices',
      icon: CreditCard,
      integrations: [
        ...(isEEAvailable ? [{
          id: 'stripe',
          name: 'Stripe',
          description: 'Accept credit card payments for invoices via Stripe',
          component: StripeConnectionSettings,
          isEE: true,
        }] : []),
      ],
    },
  ], [isEEAvailable]);

  // Filter out empty categories
  const visibleCategories = categories.filter(cat => cat.integrations.length > 0);

  // Get current category
  const currentCategory = visibleCategories.find(cat => cat.id === selectedCategory) || visibleCategories[0];

  // Build tab content
  const tabContent: TabContent[] = visibleCategories.map(category => ({
    label: category.label,
    icon: <category.icon className="w-4 h-4" />,
    content: (
      <div className="space-y-6">
        {/* Category header */}
        <div className="rounded-xl border bg-muted/30 px-6 py-8 text-center">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-3">
            <div className="flex items-center justify-center gap-3">
              <category.icon className="h-7 w-7 text-primary" />
              <h2 className="text-3xl font-bold tracking-tight">
                {category.label} Integrations
              </h2>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {category.description}
            </p>
          </div>
        </div>

        {/* Integration components */}
        {category.integrations.length > 0 ? (
          <div className="space-y-6">
            {category.integrations.map(integration => (
              <integration.component key={integration.id} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No integrations available in this category.
            {category.id === 'rmm' && !isEEAvailable && (
              <p className="mt-2 text-sm">
                RMM integrations are available in the Enterprise edition.
              </p>
            )}
          </div>
        )}
      </div>
    ),
  }));

  return (
    <div className="space-y-6">
      {/* Beta notice */}
      <Alert variant="info">
        <AlertDescription>
          Some integrations are still in development. Please work in a sandbox environment when evaluating,
          and share your feedback to help us improve.
        </AlertDescription>
      </Alert>

      {/* Category tabs */}
      <CustomTabs
        tabs={tabContent}
        defaultTab={currentCategory?.label || 'Accounting'}
        onTabChange={(tabLabel) => {
          const category = visibleCategories.find(cat => cat.label === tabLabel);
          if (category) {
            setSelectedCategory(category.id);
            const currentSearchParams = new URLSearchParams(window.location.search);
            currentSearchParams.set('tab', 'integrations');
            currentSearchParams.set('category', category.id);
            const newUrl = `${window.location.pathname}?${currentSearchParams.toString()}`;
            window.history.pushState({}, '', newUrl);
          }
        }}
      />
    </div>
  );
};

export default IntegrationsSettingsPage;
