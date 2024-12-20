import { Suspense } from "react";
import { NotificationSettings } from "@/components/settings/notifications/NotificationSettings";
import { EmailTemplates } from "@/components/settings/notifications/EmailTemplates";
import { NotificationCategories } from "@/components/settings/notifications/NotificationCategories";
import { CustomTabs } from "@/components/ui/CustomTabs";
import { Card } from "@/components/ui/Card";

export default function NotificationsSettingsPage() {
  const tabs = [
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

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-6">Notification Settings</h1>
      <Card>
        <CustomTabs tabs={tabs} />
      </Card>
    </div>
  );
}
