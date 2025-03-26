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
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';

const SettingsPage = (): JSX.Element =>  {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  

  const tabMap: Record<string, string> = {
    'teams': 'Teams',
    'users': 'Users'
  };

  const [activeTab, setActiveTab] = React.useState<string>(() => {
    if (tabParam) {
      const mappedTab = tabMap[tabParam.toLowerCase()];
      return mappedTab || 'General';
    }
    return 'General';
  });

  React.useEffect(() => {
    const mappedTab = tabParam ? tabMap[tabParam.toLowerCase()] : 'General';
    setActiveTab(mappedTab || 'General');
  }, [tabParam]);

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
    }
  ];

  const tabStyles = {
    trigger: 'flex items-center px-4 py-2 text-sm font-medium',
    activeTrigger: 'text-primary border-b-2 border-primary',
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">Admin Settings</h1>
      <CustomTabs 
        tabs={tabContent}
        defaultTab={activeTab}
        onTabChange={(tab) => {
          const reverseTabMap: Record<string, string> = {
            'Teams': 'teams',
            'Users': 'users'
          };
          setActiveTab(tab);
          
          const urlParam = reverseTabMap[tab];
          const newUrl = urlParam 
            ? `/msp/settings?tab=${urlParam}` 
            : '/msp/settings';
          
          window.history.pushState({}, '', newUrl);
        }}
        tabStyles={tabStyles}
      />
    </div>
  );
};

export default SettingsPage;
