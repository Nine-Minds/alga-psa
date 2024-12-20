import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { getNotificationSettingsAction, updateNotificationSettingsAction } from "@/lib/actions/notification-actions/notificationActions";
import { NotificationSettings as NotificationSettingsType } from "@/lib/models/notification";

export async function NotificationSettings() {
  const settings = await getNotificationSettingsAction("default"); // TODO: Get tenant from context
  
  return <NotificationSettingsForm initialSettings={settings} />;
}

function NotificationSettingsForm({ 
  initialSettings 
}: { 
  initialSettings: NotificationSettingsType 
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateNotificationSettingsAction("default", settings); // TODO: Get tenant from context
    } catch (error) {
      console.error("Failed to update notification settings:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notifications-enabled" className="text-base font-medium">
                Enable Notifications
              </Label>
              <p className="text-sm text-gray-500">
                Toggle all notifications on or off for this tenant
              </p>
            </div>
            <Switch
              id="notifications-enabled"
              checked={settings.is_enabled}
              onCheckedChange={(checked) => 
                setSettings(prev => ({ ...prev, is_enabled: checked }))
              }
            />
          </div>

          <div className="space-y-2 opacity-50">
            <div className="flex items-center gap-2">
              <Label htmlFor="rate-limit" className="text-base font-medium">
                Rate Limit (per minute)
              </Label>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                Coming Soon
              </span>
            </div>
            <p className="text-sm text-gray-500">
              Maximum number of notifications that can be sent per minute
            </p>
            <Input
              id="rate-limit"
              type="number"
              min={1}
              max={1000}
              value={settings.rate_limit_per_minute}
              onChange={(e) => 
                setSettings(prev => ({ 
                  ...prev, 
                  rate_limit_per_minute: parseInt(e.target.value) || 1 
                }))
              }
              className="max-w-xs"
              disabled
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
