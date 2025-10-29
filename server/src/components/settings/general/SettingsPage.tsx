// server/src/components/settings/SettingsPage.tsx
'use client'

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import ZeroDollarInvoiceSettings from '../billing/ZeroDollarInvoiceSettings';
import CreditExpirationSettings from '../billing/CreditExpirationSettings';
import CustomTabs, { TabContent } from "server/src/components/ui/CustomTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { Input } from "server/src/components/ui/Input";
import { Button } from "server/src/components/ui/Button";
import GeneralSettings from 'server/src/components/settings/general/GeneralSettings';
import UserManagement from 'server/src/components/settings/general/UserManagement';
import ClientPortalSettings from 'server/src/components/settings/general/ClientPortalSettings';
import SettingsTabSkeleton from 'server/src/components/ui/skeletons/SettingsTabSkeleton';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';
import { FeaturePlaceholder } from 'server/src/components/FeaturePlaceholder';

// Dynamic imports for heavy settings components
const TicketingSettings = dynamic(() => import('server/src/components/settings/general/TicketingSettings'), {
  loading: () => <SettingsTabSkeleton title="Ticketing Settings" description="Loading ticketing configuration..." />,
  ssr: false
});

const TeamManagement = dynamic(() => import('server/src/components/settings/general/TeamManagement'), {
  loading: () => <SettingsTabSkeleton title="Team Management" description="Loading team configuration..." showTabs={false} />,
  ssr: false
});
import InteractionTypesSettings from 'server/src/components/settings/general/InteractionTypeSettings';
import TimeEntrySettings from 'server/src/components/settings/time-entry/TimeEntrySettings';
import BillingSettings from 'server/src/components/settings/billing/BillingSettings'; // Import the new component
import NumberingSettings from 'server/src/components/settings/general/NumberingSettings';
import NotificationsTab from 'server/src/components/settings/general/NotificationsTab';
import { TaxRegionsManager } from 'server/src/components/settings/tax/TaxRegionsManager'; // Import the new component
// Removed import: import IntegrationsTabLoader from './IntegrationsTabLoader';
import QboIntegrationSettings from '../integrations/QboIntegrationSettings'; // Import the actual settings component
import { useSearchParams } from 'next/navigation';
// Extensions are only available in Enterprise Edition
import { EmailSettings } from 'server/src/components/admin/EmailSettings';
import { EmailProviderConfiguration } from 'server/src/components/EmailProviderConfiguration';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
// Removed import: import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

// Revert to standard function component
const SettingsPage = (): JSX.Element =>  {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  const billingFeatureFlag = useFeatureFlag('billing-enabled');
  const isBillingEnabled = typeof billingFeatureFlag === 'boolean' ? billingFeatureFlag : billingFeatureFlag?.enabled;
  const advancedFeatureFlag = useFeatureFlag('advanced-features-enabled');
  const isAdvancedFeaturesEnabled = typeof advancedFeatureFlag === 'boolean' ? advancedFeatureFlag : advancedFeatureFlag?.enabled;
  // Extensions are conditionally available based on edition
  // The webpack alias will resolve to either the EE component or empty component
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  // Dynamically load the Extensions (Manage) component using stable package paths
  const DynamicExtensionsComponent = isEEAvailable ? dynamic(() =>
    import('@product/settings-extensions/entry').then(mod => mod.DynamicExtensionsComponent),
    {
      loading: () => <div className="text-center py-8 text-gray-500">Loading extensions...</div>,
      ssr: false
    }
  ) : () => <div className="text-center py-8 text-gray-500">Extensions not available in this edition</div>;

  // Dynamically load the new Installer using stable package paths
  const DynamicInstallComponent = isEEAvailable ? dynamic(() =>
    import('@product/settings-extensions/entry').then(mod => mod.DynamicInstallExtensionComponent as any),
    {
      loading: () => <div className="text-center py-8 text-gray-500">Loading installer...</div>,
      ssr: false
    }
  ) : () => null;

  // Map URL slugs (kebab-case) to Tab Labels
  const slugToLabelMap = useMemo<Record<string, string>>(() => ({
    general: 'General',
    'client-portal': 'Client Portal',
    users: 'Users',
    teams: 'Teams',
    ticketing: 'Ticketing',
    'interaction-types': 'Interaction Types',
    notifications: 'Notifications',
    'time-entry': 'Time Entry',
    billing: 'Billing',
    tax: 'Tax',
    email: 'Email',
    integrations: 'Integrations',
    ...(isEEAvailable && { extensions: 'Extensions' }) // Only add if EE is available
  }), [isEEAvailable]);

  const labelToSlugMap = useMemo<Record<string, string>>(() => (
    Object.entries(slugToLabelMap).reduce((acc, [slug, label]) => {
      acc[label] = slug;
      return acc;
    }, {} as Record<string, string>)
  ), [slugToLabelMap]);

  const initialTabLabel = useMemo(() => {
    const mappedLabel = tabParam
      ? slugToLabelMap[tabParam.toLowerCase()]
      : undefined;

    return mappedLabel ?? 'General';
  }, [tabParam, slugToLabelMap]);

  // Initialize with URL-aware default so SSR and hydration stay aligned
  const [activeTab, setActiveTab] = useState<string>(initialTabLabel);
  const hydrationReadyRef = useRef(false);

  // Handle client-side initialization
  useEffect(() => {
    hydrationReadyRef.current = true;

    const targetLabel = initialTabLabel;

    setActiveTab((prev) => (prev === targetLabel ? prev : targetLabel));
  }, [initialTabLabel]);

  const handleTabChange = useCallback((tab: string) => {
    if (!hydrationReadyRef.current) {
      return;
    }

    setActiveTab(tab);

    const urlSlug = labelToSlugMap[tab];
    const newUrl = urlSlug && urlSlug !== 'general'
      ? `/msp/settings?tab=${urlSlug}`
      : '/msp/settings';

    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', newUrl);
    }
  }, [labelToSlugMap]);

  const baseTabContent: TabContent[] = [
    {
      label: "General",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
            <CardDescription>
              Manage your organization name and default client. The default client is used for configuration purposes and represents your MSP.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <GeneralSettings />
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Client Portal",
      content: <ClientPortalSettings />,
    },
    {
      label: "Users",
      content: <UserManagement />,
    },
    {
      label: "Teams",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Team Management</CardTitle>
            <CardDescription>Manage teams and team members</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<SettingsTabSkeleton title="Team Management" description="Loading team configuration..." showTabs={false} />}>
              <TeamManagement />
            </Suspense>
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Ticketing",
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Ticketing Settings" description="Loading ticketing configuration..." />}>
          <TicketingSettings />
        </Suspense>
      ),
    },
    {
      label: "Interaction Types",
      content: <InteractionTypesSettings />,
    },
    {
      label: "Notifications",
      content: <NotificationsTab />,
    },
    {
      label: "Time Entry",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Time Entry Settings</CardTitle>
            <CardDescription>Manage your time entry settings and time periods</CardDescription>
          </CardHeader>
          <CardContent>
            <TimeEntrySettings />
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Billing",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Billing Settings</CardTitle>
            <CardDescription>Manage your billing and subscription</CardDescription>
          </CardHeader>
          <CardContent>
            <BillingSettings />
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Tax",
      content: isBillingEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle>Tax Settings</CardTitle>
            <CardDescription>Manage tax regions and related settings</CardDescription>
          </CardHeader>
          <CardContent>
            <TaxRegionsManager />
          </CardContent>
        </Card>
      ) : (
        <FeaturePlaceholder />
      ),
    },
    {
      label: "Email",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Email Configuration</CardTitle>
            <CardDescription>Configure email providers, domains, and settings</CardDescription>
          </CardHeader>
          <CardContent>
            <EmailSettings />
          </CardContent>
        </Card>
      ),
    },
    { // Add the new Integrations tab definition
      label: "Integrations",
      content: isAdvancedFeaturesEnabled ? (
        <div className="space-y-6">
          <Alert variant="info">
            <AlertDescription>
              QuickBooks Online and Xero integrations are available to testers only. Expect missing pieces while we iterate, and please work in a sandbox environment when evaluating. We appreciate your feedback as we move toward general availability.
            </AlertDescription>
          </Alert>

          {/* QuickBooks Online Integration */}
          <QboIntegrationSettings />

          {/* Inbound Email Integration */}
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
        </div>
      ) : <FeaturePlaceholder />,
    }
  ];

  // Always include an "Extensions" tab.
  // - EE: full Manage + Install sub-tabs
  // - OSS: enterprise-only stub
  const tabContent: TabContent[] = [
    ...baseTabContent,
    {
      label: "Extensions",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Extension Management</CardTitle>
            <CardDescription>Install, configure, and manage extensions to extend Alga PSA functionality</CardDescription>
          </CardHeader>
          <CardContent>
            {isEEAvailable ? (
              <div className="space-y-4">
                <CustomTabs
                  tabs={[
                    {
                      label: "Manage",
                      content: (
                        <div className="py-2">
                          <DynamicExtensionsComponent />
                        </div>
                      )
                    },
                    {
                      label: "Install",
                      content: (
                        <div className="py-2">
                          {/* EE server-actions installer, styled with standard UI */}
                          <DynamicInstallComponent />
                        </div>
                      )
                    }
                  ] as TabContent[]}
                  defaultTab="Manage"
                />
              </div>
            ) : (
              <div className="text-center py-10">
                <div className="text-lg font-medium text-gray-900">Enterprise feature</div>
                <p className="text-sm text-gray-600 mt-2">
                  Extensions are available in the Enterprise edition of Alga PSA.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ),
    }
  ];


  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Admin Settings</h1>
      <CustomTabs
        tabs={tabContent}
        defaultTab={activeTab}
        onTabChange={handleTabChange}
      />
    </div>
  );
};

export default SettingsPage;
