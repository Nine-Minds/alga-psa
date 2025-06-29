import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { CustomTabs } from "server/src/components/ui/CustomTabs";
import { NotificationSettings } from "server/src/components/settings/notifications/NotificationSettings";
import { EmailTemplates } from "server/src/components/settings/notifications/EmailTemplates";
import { NotificationCategories } from "server/src/components/settings/notifications/NotificationCategories";
import { TelemetrySettings } from "server/src/components/settings/telemetry/TelemetrySettings";

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
