'use client';


import { useState, useEffect } from "react";
import { Card } from "@alga-psa/ui/components/Card";
import { Switch } from "@alga-psa/ui/components/Switch";
import { Label } from "@alga-psa/ui/components/Label";
import { Button } from "@alga-psa/ui/components/Button";
import { useSession } from "next-auth/react";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import { getNotificationSettingsAction, updateNotificationSettingsAction } from "../../actions";
import { NotificationSettings as NotificationSettingsType } from "../../types/notification";
import LoadingIndicator from "@alga-psa/ui/components/LoadingIndicator";

export function NotificationSettings() {
  const { t } = useTranslation('msp/settings');
  const [settings, setSettings] = useState<NotificationSettingsType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: session } = useSession();
  const tenant = (session?.user as any)?.tenant as string | undefined;

  useEffect(() => {
    const tenantValue = tenant;
    if (!tenantValue) {
      return;
    }
    async function init(tenantForRequest: string) {
      try {
        const currentSettings = await getNotificationSettingsAction(tenantForRequest);
        setSettings(currentSettings);
      } catch (err) {
        console.error('Failed to load notification settings:', err);
        setError(t('notifications.settingsForm.loadError', 'Failed to load settings'));
      }
    }
    init(tenantValue);
  }, [tenant]);

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (!settings || !tenant) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text={t('notifications.settingsForm.loading', 'Loading notification settings...')}
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
  const { t } = useTranslation('msp/settings');
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
                {t('notifications.settingsForm.enable.label', 'Enable Notifications')}
              </Label>
              <p className="text-sm text-gray-500">
                {t('notifications.settingsForm.enable.description', 'Toggle all notifications on or off for this tenant')}
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

        </div>

        <div className="mt-6 flex justify-end">
          <Button id="save-notification-settings-btn" type="submit" disabled={isSaving}>
            {isSaving
              ? t('notifications.settingsForm.saving', 'Saving...')
              : t('notifications.settingsForm.save', 'Save Changes')}
          </Button>
        </div>
      </Card>
    </form>
  );
}
