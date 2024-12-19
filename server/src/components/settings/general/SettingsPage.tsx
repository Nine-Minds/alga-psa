// server/src/components/settings/SettingsPage.tsx
'use client'

import React from 'react';
import CustomTabs, { TabContent } from "@/components/ui/CustomTabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import TicketingSettings from './TicketingSettings';
import UserManagement from './UserManagement';
import TeamManagement from './TeamManagement';
import InteractionTypesSettings from './InteractionTypeSettings';
import TimePeriodSettings from '../billing/TimePeriodSettings';
import NotificationsTab from './NotificationsTab';
import { useRouter } from 'next/navigation';

const SettingsPage = (): JSX.Element =>  {
  const router = useRouter();
  const [companyName, setCompanyName] = React.useState('Your MSP Company');

  const tabContent: TabContent[] = [
    {
      label: "General",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
            <CardDescription>Manage your company&apos;s general settings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
              <Button>Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Profile",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Profile Settings</CardTitle>
            <CardDescription>Manage your personal profile and preferences</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/profile')}>
              Go to Profile Settings
            </Button>
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
            {/* Add more billing management components */}
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
        defaultTab="General"
        tabStyles={tabStyles}
      />
    </div>
  );
};

export default SettingsPage;
