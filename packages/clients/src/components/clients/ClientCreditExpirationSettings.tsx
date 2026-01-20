import React, { useEffect, useState } from 'react';
import { Text } from '@radix-ui/themes';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import toast from 'react-hot-toast';
import {
  getClientContractLineSettingsAsync,
  updateClientContractLineSettingsAsync
} from "../../lib/billingHelpers";

// Local type definition to avoid circular dependency
interface BillingSettings {
  zeroDollarInvoiceHandling?: 'normal' | 'finalized';
  suppressZeroDollarInvoices?: boolean;
  enableCreditExpiration?: boolean;
  creditExpirationDays?: number;
  creditExpirationNotificationDays?: number[];
}

interface ClientCreditExpirationSettingsProps {
  clientId: string;
}

const ClientCreditExpirationSettings: React.FC<ClientCreditExpirationSettingsProps> = ({ clientId }) => {
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [useDefault, setUseDefault] = useState(true);
  const [notificationDays, setNotificationDays] = useState<string>('');

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const clientSettings = await getClientContractLineSettingsAsync(clientId);
        if (clientSettings) {
          setSettings(clientSettings);
          setNotificationDays(clientSettings.creditExpirationNotificationDays?.join(', ') || '');
          setUseDefault(false);
        } else {
          setUseDefault(true);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load settings");
      }
    };

    loadSettings();
  }, [clientId]);

  const handleEnableChange = async (checked: boolean) => {
    if (!settings) return;
    
    try {
      const newSettings: BillingSettings = {
        ...settings,
        enableCreditExpiration: checked,
      };
      const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
      if (result.success) {
        setSettings(newSettings);
        setUseDefault(false);
        toast.success("Credit expiration settings have been updated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  const handleExpirationDaysChange = (value: string) => {
    if (!settings) return;
    
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

  const saveExpirationDays = async () => {
    if (!settings) return;
    
    try {
      const newSettings: BillingSettings = {
        ...settings,
        creditExpirationDays: settings.creditExpirationDays
      };
      const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
      if (result.success) {
        setSettings(newSettings);
        setUseDefault(false);
        toast.success("Credit expiration period has been updated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  const saveNotificationDays = async () => {
    if (!settings) return;
    
    try {
      // Parse notification days from comma-separated string
      const days = notificationDays
        .split(',')
        .map(day => parseInt(day.trim()))
        .filter(day => !isNaN(day) && day >= 0)
        .sort((a, b) => b - a); // Sort in descending order

      const newSettings: BillingSettings = {
        ...settings,
        creditExpirationNotificationDays: days
      };

      const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
      if (result.success) {
        setSettings(newSettings);
        setUseDefault(false);
        toast.success("Notification days have been updated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  const handleUseDefaultChange = async (checked: boolean) => {
    try {
      if (checked) {
        // Remove client override
        const result = await updateClientContractLineSettingsAsync(clientId, null);
        if (result.success) {
          setSettings(null);
          setUseDefault(true);
          toast.success("Client will now use default credit expiration settings.");
        }
      } else {
        // Create client override with current settings
        const defaultSettings = await getClientContractLineSettingsAsync(clientId);
        const newSettings: BillingSettings = {
          zeroDollarInvoiceHandling: defaultSettings?.zeroDollarInvoiceHandling || 'normal',
          suppressZeroDollarInvoices: defaultSettings?.suppressZeroDollarInvoices || false,
          enableCreditExpiration: defaultSettings?.enableCreditExpiration ?? true,
          creditExpirationDays: defaultSettings?.creditExpirationDays ?? 365,
          creditExpirationNotificationDays: defaultSettings?.creditExpirationNotificationDays ?? [30, 7, 1],
        };
        const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
        if (result.success) {
          setSettings(newSettings);
          setNotificationDays(newSettings.creditExpirationNotificationDays?.join(', ') || '');
          setUseDefault(false);
          toast.success("Client-specific credit expiration settings enabled.");
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update settings");
    }
  };

  return (
    <div className="mt-6">
      <div>
        <Text as="div" size="3" mb="4" weight="medium" className="text-gray-900">
          Credit Expiration Settings
        </Text>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="use-default-credit-expiration"
              checked={useDefault}
              onCheckedChange={handleUseDefaultChange}
            />
            <div className="space-y-1">
              <Label htmlFor="use-default-credit-expiration">Use Default Settings</Label>
              <p className="text-sm text-muted-foreground">
                Use the system-wide default settings for credit expiration
              </p>
            </div>
          </div>

          <div className={useDefault ? 'opacity-50 pointer-events-none' : ''}>
            <div className="flex items-center space-x-2 mb-4">
              <Switch
                id="enable-credit-expiration"
                checked={settings?.enableCreditExpiration ?? true}
                onCheckedChange={handleEnableChange}
                disabled={useDefault}
              />
              <div className="space-y-1">
                <Label htmlFor="enable-credit-expiration">Enable Credit Expiration</Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, credits will expire after the specified period
                </p>
              </div>
            </div>

            {settings?.enableCreditExpiration && (
              <>
                <div className="space-y-2 mb-4">
                  <Label htmlFor="expiration-days">Expiration Period (Days)</Label>
                  <div className="flex space-x-2 items-start">
                    <Input
                      id="expiration-days"
                      type="number"
                      min="1"
                      value={settings?.creditExpirationDays || ''}
                      onChange={(e) => handleExpirationDaysChange(e.target.value)}
                      className="max-w-xs"
                      disabled={useDefault}
                    />
                    <Button 
                      onClick={saveExpirationDays} 
                      id="save-expiration-days"
                      disabled={useDefault}
                    >
                      Save
                    </Button>
                  </div>
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
                      disabled={useDefault}
                    />
                    <Button 
                      onClick={saveNotificationDays} 
                      id="save-notification-days"
                      disabled={useDefault}
                    >
                      Save
                    </Button>
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
    </div>
  );
};

export default ClientCreditExpirationSettings;
