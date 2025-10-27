import React from 'react';
import { Switch } from "server/src/components/ui/Switch";
import { Label } from "server/src/components/ui/Label";
import { Input } from "server/src/components/ui/Input";
import { Button } from "server/src/components/ui/Button";
import toast from 'react-hot-toast';
import { getDefaultBillingSettings, updateDefaultBillingSettings, type BillingSettings } from "@product/actions/billingSettingsActions";

const CreditExpirationSettings = (): JSX.Element => {
  const [settings, setSettings] = React.useState<BillingSettings>({
    zeroDollarInvoiceHandling: 'normal',
    suppressZeroDollarInvoices: false,
    enableCreditExpiration: true,
    creditExpirationDays: 365,
    creditExpirationNotificationDays: [30, 7, 1]
  });

  const [notificationDays, setNotificationDays] = React.useState<string>('');

  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        const currentSettings = await getDefaultBillingSettings();
        setSettings(currentSettings);
        setNotificationDays(currentSettings.creditExpirationNotificationDays?.join(', ') || '');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load settings");
      }
    };

    loadSettings();
  }, []);

  const handleEnableChange = async (checked: boolean) => {
    try {
      const newSettings = {
        ...settings,
        enableCreditExpiration: checked,
      };
      const result = await updateDefaultBillingSettings(newSettings);
      if (result.success) {
        setSettings(newSettings);
        toast.success("Credit expiration settings have been updated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  const handleExpirationDaysChange = (value: string) => {
    const days = parseInt(value);
    if (!isNaN(days) && days >= 0) {
      setSettings({
        ...settings,
        creditExpirationDays: days
      });
    }
  };

  const handleNotificationDaysChange = (value: string) => {
    setNotificationDays(value);
  };

  const saveSettings = async () => {
    try {
      // Parse notification days from comma-separated string
      const days = notificationDays
        .split(',')
        .map(day => parseInt(day.trim()))
        .filter(day => !isNaN(day) && day >= 0)
        .sort((a, b) => b - a); // Sort in descending order

      const newSettings = {
        ...settings,
        creditExpirationNotificationDays: days
      };

      const result = await updateDefaultBillingSettings(newSettings);
      if (result.success) {
        setSettings(newSettings);
        toast.success("Credit expiration settings have been updated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">Credit Expiration Settings</h3>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="enable-credit-expiration"
              checked={settings.enableCreditExpiration}
              onCheckedChange={handleEnableChange}
            />
            <div className="space-y-1">
              <Label htmlFor="enable-credit-expiration">Enable Credit Expiration</Label>
              <p className="text-sm text-muted-foreground">
                When enabled, credits will expire after the specified period
              </p>
            </div>
          </div>

          {settings.enableCreditExpiration && (
            <>
              <div className="space-y-2">
                <Label htmlFor="expiration-days">Expiration Period (Days)</Label>
                <Input
                  id="expiration-days"
                  type="number"
                  min="1"
                  value={settings.creditExpirationDays || ''}
                  onChange={(e) => handleExpirationDaysChange(e.target.value)}
                  className="max-w-xs"
                />
                <p className="text-sm text-muted-foreground">
                  Number of days after which credits will expire
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notification-days">Notification Days</Label>
                <div className="flex space-x-2 items-start">
                  <Input
                    id="notification-days"
                    value={notificationDays}
                    onChange={(e) => handleNotificationDaysChange(e.target.value)}
                    placeholder="e.g., 30, 7, 1"
                    className="max-w-xs"
                  />
                  <Button onClick={saveSettings} id="save-notification-days">Save</Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Days before expiration to send notifications (comma-separated)
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreditExpirationSettings;