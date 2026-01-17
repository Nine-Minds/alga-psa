'use client';

import { useState, useEffect } from "react";
import { Card } from "@alga-psa/ui/components/Card";
import { Switch } from "@alga-psa/ui/components/Switch";
import { Input } from "@alga-psa/ui/components/Input";
import { Label } from "@alga-psa/ui/components/Label";
import { Button } from "@alga-psa/ui/components/Button";
import { getNotificationSettingsAction, updateNotificationSettingsAction } from "server/src/lib/actions/notification-actions/notificationActions";
import { NotificationSettings as NotificationSettingsType } from "server/src/lib/models/notification";
import { getCurrentTenant } from "server/src/lib/tenant-client";
import LoadingIndicator from "@alga-psa/ui/components/LoadingIndicator";

export function NotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettingsType | null>(null);
  const [tenant, setTenant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const currentTenant = await getCurrentTenant();
        setTenant(currentTenant);
        const currentSettings = await getNotificationSettingsAction(currentTenant);
        setSettings(currentSettings);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      }
    }
    init();
  }, []);

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!settings || !tenant) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator 
          layout="stacked" 
          text="Loading notification settings..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  return <NotificationSettingsForm initialSettings={settings} tenant={tenant} />;
}

function NotificationSettingsForm({ 
  initialSettings,
  tenant
}: { 
  initialSettings: NotificationSettingsType;
  tenant: string;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await updateNotificationSettingsAction(tenant, settings);
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
          <Button id="save-notification-settings-btn" type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
