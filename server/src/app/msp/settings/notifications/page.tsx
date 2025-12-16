'use client';

import { Suspense, useState, useCallback } from "react";
import { NotificationSettings } from "server/src/components/settings/notifications/NotificationSettings";
import { EmailTemplates } from "server/src/components/settings/notifications/EmailTemplates";
import { NotificationCategories } from "server/src/components/settings/notifications/NotificationCategories";
import { InternalNotificationCategories } from "server/src/components/settings/notifications/InternalNotificationCategories";
import { CustomTabs } from "server/src/components/ui/CustomTabs";
import ViewSwitcher, { ViewSwitcherOption } from "server/src/components/ui/ViewSwitcher";
import { Card } from "server/src/components/ui/Card";
import { UnsavedChangesProvider, useUnsavedChanges } from "server/src/contexts/UnsavedChangesContext";

type NotificationView = 'email' | 'internal';

export default function NotificationsSettingsPage() {
  return (
    <UnsavedChangesProvider
      dialogTitle="Unsaved Changes"
      dialogMessage="You have unsaved notification settings. Are you sure you want to leave? Your changes will be lost."
    >
      <NotificationsSettingsContent />
    </UnsavedChangesProvider>
  );
}

function NotificationsSettingsContent() {
  const [currentView, setCurrentView] = useState<NotificationView>('internal');
  const [currentTab, setCurrentTab] = useState<string>('Categories & Types');
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
      // Reset to first tab of new view
      setCurrentTab(newView === 'email' ? 'Settings' : 'Categories & Types');
    });
  }, [currentView, confirmNavigation]);

  // Handle tab change with confirmation (controlled mode)
  const handleTabChange = useCallback((newTab: string) => {
    if (newTab === currentTab) return;

    confirmNavigation(() => {
      setCurrentTab(newTab);
    });
  }, [currentTab, confirmNavigation]);

  const emailTabs = [
    {
      label: "Settings",
      content: (
        <Suspense fallback={<div>Loading settings...</div>}>
          <NotificationSettings />
        </Suspense>
      ),
    },
    {
      label: "Email Templates",
      content: (
        <Suspense fallback={<div>Loading templates...</div>}>
          <EmailTemplates />
        </Suspense>
      ),
    },
    {
      label: "Categories",
      content: (
        <Suspense fallback={<div>Loading categories...</div>}>
          <NotificationCategories />
        </Suspense>
      ),
    },
  ];

  const internalTabs = [
    {
      label: "Categories & Types",
      content: (
        <Suspense fallback={<div>Loading categories...</div>}>
          <InternalNotificationCategories />
        </Suspense>
      ),
    },
  ];

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Notification Settings</h1>
          <p className="text-gray-600 text-sm mt-1">
            {currentView === 'email'
              ? 'Configure tenant-wide email notification settings'
              : 'Configure tenant-wide internal notification settings'}
          </p>
        </div>
        <ViewSwitcher
          currentView={currentView}
          onChange={handleViewChange}
          options={viewOptions}
        />
      </div>
      <Card>
        <CustomTabs
          key={currentView}
          tabs={currentView === 'email' ? emailTabs : internalTabs}
          value={currentTab}
          onTabChange={handleTabChange}
        />
      </Card>
    </div>
  );
}
