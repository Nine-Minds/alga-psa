'use client';

import { Suspense, useState } from "react";
import { NotificationSettings } from "server/src/components/settings/notifications/NotificationSettings";
import { EmailTemplates } from "server/src/components/settings/notifications/EmailTemplates";
import { NotificationCategories } from "server/src/components/settings/notifications/NotificationCategories";
import { InternalNotificationCategories } from "server/src/components/settings/notifications/InternalNotificationCategories";
import { CustomTabs } from "server/src/components/ui/CustomTabs";
import ViewSwitcher, { ViewSwitcherOption } from "server/src/components/ui/ViewSwitcher";
import { Card } from "server/src/components/ui/Card";

type NotificationView = 'email' | 'internal';

export default function NotificationsSettingsPage() {
  const [currentView, setCurrentView] = useState<NotificationView>('internal');

  const viewOptions: ViewSwitcherOption<NotificationView>[] = [
    { value: 'email', label: 'Email Notifications' },
    { value: 'internal', label: 'In-App Notifications' },
  ];

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
      label: "Categories & Types",
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
              : 'Configure tenant-wide in-app notification settings'}
          </p>
        </div>
        <ViewSwitcher
          currentView={currentView}
          onChange={setCurrentView}
          options={viewOptions}
        />
      </div>
      <Card>
        <CustomTabs tabs={currentView === 'email' ? emailTabs : internalTabs} />
      </Card>
    </div>
  );
}
