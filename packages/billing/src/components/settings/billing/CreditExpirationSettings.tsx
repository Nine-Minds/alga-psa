import React from 'react';
import { Switch } from "@alga-psa/ui/components/Switch";
import { Label } from "@alga-psa/ui/components/Label";
import { Input } from "@alga-psa/ui/components/Input";
import { Button } from "@alga-psa/ui/components/Button";
import toast from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from "@alga-psa/billing/actions";
import type { BillingSettings } from "@alga-psa/billing/actions";

const CreditExpirationSettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/billing-settings');
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
        handleError(error, t('general.creditExpiration.errors.load', { defaultValue: 'Failed to load settings' }));
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
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (result.success) {
        setSettings(newSettings);
        toast.success(t('general.creditExpiration.toast.updated', {
          defaultValue: 'Credit expiration settings have been updated.'
        }));
      }
    } catch (error) {
      handleError(error, t('general.creditExpiration.errors.save', { defaultValue: 'Failed to save settings' }));
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
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (result.success) {
        setSettings(newSettings);
        toast.success(t('general.creditExpiration.toast.updated', {
          defaultValue: 'Credit expiration settings have been updated.'
        }));
      }
    } catch (error) {
      handleError(error, t('general.creditExpiration.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Switch
          id="enable-credit-expiration"
          checked={settings.enableCreditExpiration}
          onCheckedChange={handleEnableChange}
        />
        <div className="space-y-1">
          <Label htmlFor="enable-credit-expiration">
            {t('general.creditExpiration.fields.enabled.label', {
              defaultValue: 'Enable Credit Expiration'
            })}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('general.creditExpiration.fields.enabled.help', {
              defaultValue: 'When enabled, credits will expire after the specified period'
            })}
          </p>
        </div>
      </div>

      {settings.enableCreditExpiration && (
        <>
          <div className="space-y-2">
            <Label htmlFor="expiration-days">
              {t('general.creditExpiration.fields.expirationDays.label', {
                defaultValue: 'Expiration Period (Days)'
              })}
            </Label>
            <Input
              id="expiration-days"
              type="number"
              min="1"
              value={settings.creditExpirationDays || ''}
              onChange={(e) => handleExpirationDaysChange(e.target.value)}
              className="max-w-xs"
            />
            <p className="text-sm text-muted-foreground">
              {t('general.creditExpiration.fields.expirationDays.help', {
                defaultValue: 'Number of days after which credits will expire'
              })}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notification-days">
              {t('general.creditExpiration.fields.notificationDays.label', {
                defaultValue: 'Notification Days'
              })}
            </Label>
            <div className="flex space-x-2 items-start">
              <Input
                id="notification-days"
                value={notificationDays}
                onChange={(e) => handleNotificationDaysChange(e.target.value)}
                placeholder={t('general.creditExpiration.fields.notificationDays.placeholder', {
                  defaultValue: 'e.g., 30, 7, 1'
                })}
                className="max-w-xs"
              />
              <Button onClick={saveSettings} id="save-notification-days">
                {t('general.creditExpiration.actions.save', { defaultValue: 'Save' })}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('general.creditExpiration.fields.notificationDays.help', {
                defaultValue: 'Days before expiration to send notifications (comma-separated)'
              })}
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default CreditExpirationSettings;
