// server/src/components/settings/SettingsPage.tsx
'use client'

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Settings, Globe, UserCog, Users, MessageSquare, Layers, Handshake, Bell, Clock, CreditCard, Download, Mail, Plug, Puzzle } from 'lucide-react';
import ZeroDollarInvoiceSettings from '../billing/ZeroDollarInvoiceSettings';
import CreditExpirationSettings from '../billing/CreditExpirationSettings';
import CustomTabs, { TabContent, TabGroup } from "server/src/components/ui/CustomTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { Input } from "server/src/components/ui/Input";
import { Button } from "server/src/components/ui/Button";
import GeneralSettings from 'server/src/components/settings/general/GeneralSettings';
import UserManagement from 'server/src/components/settings/general/UserManagement';
import ClientPortalSettings from 'server/src/components/settings/general/ClientPortalSettings';
import SettingsTabSkeleton from 'server/src/components/ui/skeletons/SettingsTabSkeleton';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

// Dynamic imports for heavy settings components
const TicketingSettings = dynamic(() => import('server/src/components/settings/general/TicketingSettings'), {
  loading: () => <SettingsTabSkeleton title="Ticketing Settings" description="Loading ticketing configuration..." />,
  ssr: false
});

const TeamManagement = dynamic(() => import('server/src/components/settings/general/TeamManagement'), {
  loading: () => <SettingsTabSkeleton title="Team Management" description="Loading team configuration..." showTabs={false} />,
  ssr: false
});
import InteractionSettings from 'server/src/components/settings/general/InteractionSettings';
import TimeEntrySettings from 'server/src/components/settings/time-entry/TimeEntrySettings';
import BillingSettings from 'server/src/components/settings/billing/BillingSettings'; // Import the new component
import NumberingSettings from 'server/src/components/settings/general/NumberingSettings';
import NotificationsTab from 'server/src/components/settings/general/NotificationsTab';
// Removed import: import IntegrationsTabLoader from './IntegrationsTabLoader';
import IntegrationsSettingsPage from '../integrations/IntegrationsSettingsPage';
import { useSearchParams } from 'next/navigation';
import ImportExportSettings from 'server/src/components/settings/import-export/ImportExportSettings';
// Extensions are only available in Enterprise Edition
import { EmailSettings } from '@product/email-settings/entry';
import { EmailProviderConfiguration } from 'server/src/components/EmailProviderConfiguration';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import Link from 'next/link';
// Removed import: import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import SurveySettings from 'server/src/components/surveys/SurveySettings';
import ProjectSettings from './ProjectSettings';

// Revert to standard function component
const SettingsPage = (): JSX.Element =>  {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  // Extensions are conditionally available based on edition
  // The webpack alias will resolve to either the EE component or empty component
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  // Dynamically load the Extensions (Manage) component using stable package paths
  const DynamicExtensionsComponent = isEEAvailable ? dynamic(() =>
    import('@product/settings-extensions/entry').then(mod => mod.DynamicExtensionsComponent),
    {
      loading: () => (
        <div className="flex items-center justify-center py-8">
          <LoadingIndicator 
            layout="stacked" 
            text="Loading extensions..."
            spinnerProps={{ size: 'md' }}
          />
        </div>
      ),
      ssr: false
    }
  ) : () => <div className="text-center py-8 text-gray-500">Extensions not available in this edition</div>;

  // Dynamically load the new Installer using stable package paths
  const DynamicInstallComponent = isEEAvailable ? dynamic(() =>
    import('@product/settings-extensions/entry').then(mod => mod.DynamicInstallExtensionComponent as any),
    {
      loading: () => (
        <div className="flex items-center justify-center py-8">
          <LoadingIndicator 
            layout="stacked" 
            text="Loading installer..."
            spinnerProps={{ size: 'md' }}
          />
        </div>
      ),
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
    projects: 'Projects',
    interactions: 'Interactions',
    notifications: 'Notifications',
    'time-entry': 'Time Entry',
    billing: 'Billing',
    'import-export': 'Import/Export',
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
      icon: Settings,
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
      icon: Globe,
      content: <ClientPortalSettings />,
    },
    {
      label: "Users",
      icon: UserCog,
      content: <UserManagement />,
    },
    {
      label: "Teams",
      icon: Users,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Team Management</CardTitle>
            <CardDescription>Manage teams and team members</CardDescription>
          </CardHeader>
          <CardContent className="overflow-visible">
            <Suspense fallback={<SettingsTabSkeleton title="Team Management" description="Loading team configuration..." showTabs={false} />}>
              <TeamManagement />
            </Suspense>
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Ticketing",
      icon: MessageSquare,
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Ticketing Settings" description="Loading ticketing configuration..." />}>
          <TicketingSettings />
        </Suspense>
      ),
    },
    {
      label: "Projects",
      icon: Layers,
      content: <ProjectSettings />,
    },
    {
      label: "Interactions",
      icon: Handshake,
      content: (
        <Suspense fallback={<SettingsTabSkeleton title="Interactions" description="Loading interaction settings..." showTabs={false} />}>
          <InteractionSettings />
        </Suspense>
      ),
    },
    {
      label: "Notifications",
      icon: Bell,
      content: <NotificationsTab />,
    },
    {
      label: "Time Entry",
      icon: Clock,
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
      icon: CreditCard,
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
      label: "Import/Export",
      icon: Download,
      content: <ImportExportSettings />,
    },
    {
      label: "Email",
      icon: Mail,
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
    { // Integrations tab with category-based organization
      label: "Integrations",
      icon: Plug,
      content: <IntegrationsSettingsPage />,
    }
  ];

  // Always include an "Extensions" tab.
  // - EE: full Manage + Install sub-tabs
  // - OSS: enterprise-only stub
  const extensionsTab: TabContent = {
    label: "Extensions",
    icon: Puzzle,
    content: (
      <Card>
        <CardHeader>
          <CardTitle>Extension Management</CardTitle>
          <CardDescription>
            Install, configure, and manage extensions to extend Alga PSA functionality.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isEEAvailable ? (
            <div className="space-y-4">
              <CustomTabs
                tabs={[
                  {
                    label: "Manage",
                    content: (
                      <div className="py-2 space-y-3">
                        {/* Primary extensions management grid */}
                        <DynamicExtensionsComponent />
                        {/* Global debug console link for the Service Proxy Demo extension */}
                        <div className="flex items-center justify-end gap-2 text-[10px]">
                          <span className="text-slate-500">
                            Need extension logs?
                          </span>
                          <Link
                            href="/msp/extensions/d773f8f7-c46d-4c9d-a79b-b55903dd5074/debug"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 hover:border-violet-300 transition-colors"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Open Service Proxy Demo Debug Console
                          </Link>
                        </div>
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
  };

  // Organize tabs into logical functional groups
  const getTabByLabel = (label: string): TabContent | undefined => {
    return baseTabContent.find(t => t.label === label);
  };

  const tabGroups: TabGroup[] = [
    {
      title: 'Organization & Access',
      tabs: [
        getTabByLabel('General'),
        getTabByLabel('Users'),
        getTabByLabel('Teams'),
        getTabByLabel('Client Portal'),
      ].filter((tab): tab is TabContent => tab !== undefined)
    },
    {
      title: 'Work Management',
      tabs: [
        getTabByLabel('Ticketing'),
        getTabByLabel('Projects'),
        getTabByLabel('Interactions'),
      ].filter((tab): tab is TabContent => tab !== undefined)
    },
    {
      title: 'Time & Billing',
      tabs: [
        getTabByLabel('Time Entry'),
        getTabByLabel('Billing'),
      ].filter((tab): tab is TabContent => tab !== undefined)
    },
    {
      title: 'Communication',
      tabs: [
        getTabByLabel('Notifications'),
        getTabByLabel('Email'),
      ].filter((tab): tab is TabContent => tab !== undefined)
    },
    {
      title: 'Data & Integration',
      tabs: [
        getTabByLabel('Import/Export'),
        getTabByLabel('Integrations'),
        extensionsTab,
      ].filter((tab): tab is TabContent => tab !== undefined)
    }
  ];

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Admin Settings</h1>
      <CustomTabs
        tabs={[]}
        groups={tabGroups}
        defaultTab={activeTab}
        onTabChange={handleTabChange}
        orientation="vertical"
      />
    </div>
  );
};

export default SettingsPage;
