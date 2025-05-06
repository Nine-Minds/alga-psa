// server/src/components/settings/SettingsPage.tsx
'use client'

import React from 'react';
import ZeroDollarInvoiceSettings from '../billing/ZeroDollarInvoiceSettings';
import CreditExpirationSettings from '../billing/CreditExpirationSettings';
import CustomTabs, { TabContent } from "server/src/components/ui/CustomTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { Input } from "server/src/components/ui/Input";
import { Button } from "server/src/components/ui/Button";
import GeneralSettings from './GeneralSettings';
import TicketingSettings from './TicketingSettings';
import UserManagement from './UserManagement';
import TeamManagement from './TeamManagement';
import InteractionTypesSettings from './InteractionTypeSettings';
import TimePeriodSettings from '../billing/TimePeriodSettings';
import ServiceTypeSettings from '../billing/ServiceTypeSettings'; // Import the new component
import NumberingSettings from './NumberingSettings';
import NotificationsTab from './NotificationsTab';
import { TaxRegionsManager } from '../tax/TaxRegionsManager'; // Import the new component
// Removed import: import IntegrationsTabLoader from './IntegrationsTabLoader';
import QboIntegrationSettings from '../integrations/QboIntegrationSettings'; // Import the actual settings component
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
// Removed import: import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

// Revert to standard function component
const SettingsPage = (): JSX.Element =>  {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');


  // Map URL slugs (kebab-case) to Tab Labels
  const slugToLabelMap: Record<string, string> = {
    'general': 'General',
    'users': 'Users',
    'teams': 'Teams',
    'ticketing': 'Ticketing',
    'interaction-types': 'Interaction Types',
    'notifications': 'Notifications',
    'time-entry': 'Time Entry',
    'billing': 'Billing',
    'tax': 'Tax',
    'integrations': 'Integrations' // Add slug for Integrations tab
  };

  // Determine initial active tab based on URL parameter
  // Hooks are now valid again
  const [activeTab, setActiveTab] = React.useState<string>(() => {
    const initialLabel = tabParam ? slugToLabelMap[tabParam.toLowerCase()] : undefined;
    return initialLabel || 'General'; // Default to 'General' if param is missing or invalid
  });

  // Update active tab when URL parameter changes
  React.useEffect(() => {
    const currentLabel = tabParam ? slugToLabelMap[tabParam.toLowerCase()] : undefined;
    const targetTab = currentLabel || 'General';
    // Only update state if the derived tab is different from the current state
    if (targetTab !== activeTab) {
       setActiveTab(targetTab);
    }
  }, [tabParam]); // Correct dependency array

  const tabContent: TabContent[] = [
    {
      label: "General",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
            <CardDescription>Manage your organization's settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <GeneralSettings />
          </CardContent>
        </Card>
      ),
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
            <TeamManagement />
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Ticketing",
      content: <TicketingSettings />,
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
            <CardDescription>Manage your time entry settings</CardDescription>
          </CardHeader>
          <CardContent>
            <TimePeriodSettings />
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
            <div className="space-y-6">
              <div className="space-y-6">
                <NumberingSettings entityType="INVOICE" />
                <ZeroDollarInvoiceSettings />
                <CreditExpirationSettings />
                <ServiceTypeSettings /> {/* Add the new component here */}
              </div>
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Tax",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Tax Settings</CardTitle>
            <CardDescription>Manage tax regions and related settings</CardDescription>
          </CardHeader>
          <CardContent>
            <TaxRegionsManager />
          </CardContent>
        </Card>
      ),
    }
    ,
    { // Add the new Integrations tab definition
      label: "Integrations",
      // Render the QBO settings client component directly
      content: <QboIntegrationSettings />,
    }
  ];


  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Admin Settings</h1>
      <CustomTabs 
        tabs={tabContent}
        defaultTab={activeTab}
        onTabChange={(tab) => {
          // Map Tab Labels back to URL slugs (kebab-case)
          const labelToSlugMap: Record<string, string> = Object.entries(slugToLabelMap).reduce((acc, [slug, label]) => {
            acc[label] = slug;
            return acc;
          }, {} as Record<string, string>);

          // Re-add immediate state update on tab change
          setActiveTab(tab);

          const urlSlug = labelToSlugMap[tab];
          // Update URL using pushState to avoid full page reload
          // Default to '/msp/settings' if the slug is 'general' or not found
          const newUrl = urlSlug && urlSlug !== 'general'
            ? `/msp/settings?tab=${urlSlug}`
            : '/msp/settings';

          window.history.pushState({}, '', newUrl);
        }}
      />
    </div>
  );
};

export default SettingsPage;
