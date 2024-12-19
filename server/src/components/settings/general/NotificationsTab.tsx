import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { CustomTabs } from "@/components/ui/CustomTabs";
import { NotificationSettings } from "@/components/settings/notifications/NotificationSettings";
import { EmailTemplates } from "@/components/settings/notifications/EmailTemplates";
import { NotificationCategories } from "@/components/settings/notifications/NotificationCategories";

export default function NotificationsTab() {
  const tabContent = [
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
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification Settings</CardTitle>
        <CardDescription>Configure how you receive notifications</CardDescription>
      </CardHeader>
      <CardContent>
        <CustomTabs tabs={tabContent} />
      </CardContent>
    </Card>
  );
}
