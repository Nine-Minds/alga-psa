'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { CustomTabs } from "server/src/components/ui/CustomTabs";
import ViewSwitcher, { ViewSwitcherOption } from "server/src/components/ui/ViewSwitcher";
import { NotificationSettings } from "server/src/components/settings/notifications/NotificationSettings";
import { EmailTemplates } from "server/src/components/settings/notifications/EmailTemplates";
import { NotificationCategories } from "server/src/components/settings/notifications/NotificationCategories";
import { InternalNotificationCategories } from "server/src/components/settings/notifications/InternalNotificationCategories";
import { TelemetrySettings } from "server/src/components/settings/telemetry/TelemetrySettings";
import { UnsavedChangesProvider, useUnsavedChanges } from "server/src/contexts/UnsavedChangesContext";

type NotificationView = 'email' | 'internal';

export default function NotificationsTab() {
  return (
    <UnsavedChangesProvider
      dialogTitle="Unsaved Changes"
      dialogMessage="You have unsaved notification settings. Are you sure you want to leave? Your changes will be lost."
    >
      <NotificationsTabContent />
    </UnsavedChangesProvider>
  );
}

function NotificationsTabContent() {
  const [currentView, setCurrentView] = useState<NotificationView>('email');
  const { confirmNavigation } = useUnsavedChanges();

  const viewOptions: ViewSwitcherOption<NotificationView>[] = [
    { value: 'email', label: 'Email Notifications' },
    { value: 'internal', label: 'Internal Notifications' },
  ];

  // Handle view change with confirmation
  const handleViewChange = useCallback((newView: NotificationView) => {
    if (newView === currentView) return;

    confirmNavigation(() => {
      setCurrentView(newView);
    });
  }, [currentView, confirmNavigation]);

  const emailTabContent = [
    {
      label: "Settings",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Global Settings</CardTitle>
            <CardDescription>Configure global notification settings</CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationSettings />
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Email Templates",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Email Templates</CardTitle>
            <CardDescription>Manage email notification templates</CardDescription>
          </CardHeader>
          <CardContent>
            <EmailTemplates />
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Categories",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Notification Categories</CardTitle>
            <CardDescription>Manage notification categories and types</CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationCategories />
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Telemetry",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Telemetry & Analytics</CardTitle>
            <CardDescription>Manage your telemetry and analytics preferences</CardDescription>
          </CardHeader>
          <CardContent>
            <TelemetrySettings />
          </CardContent>
        </Card>
      ),
    },
  ];

  const internalTabContent = [
    {
      label: "Categories",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Internal Notification Categories</CardTitle>
            <CardDescription>Manage internal notification categories and types</CardDescription>
          </CardHeader>
          <CardContent>
            <InternalNotificationCategories />
          </CardContent>
        </Card>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Notification Settings</CardTitle>
            <CardDescription>
              {currentView === 'email'
                ? 'Configure how your tenant sends email notifications'
                : 'Configure how your tenant sends internal notifications'}
            </CardDescription>
          </div>
          <ViewSwitcher
            currentView={currentView}
            onChange={handleViewChange}
            options={viewOptions}
          />
        </div>
      </CardHeader>
      <CardContent>
        <CustomTabs
          key={currentView}
          tabs={currentView === 'email' ? emailTabContent : internalTabContent}
        />
      </CardContent>
    </Card>
  );
}
