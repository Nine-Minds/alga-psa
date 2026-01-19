import React, { useEffect, useState } from 'react';
import { Text } from '@radix-ui/themes';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import toast from 'react-hot-toast';
import { getClientContractLineSettings, updateClientContractLineSettings } from "@alga-psa/billing/actions";
import type { BillingSettings } from "@alga-psa/billing/actions";

interface ClientZeroDollarInvoiceSettingsProps {
  clientId: string;
}

const ClientZeroDollarInvoiceSettings: React.FC<ClientZeroDollarInvoiceSettingsProps> = ({ clientId }) => {
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [useDefault, setUseDefault] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const clientSettings = await getClientContractLineSettings(clientId);
        if (clientSettings) {
          setSettings(clientSettings);
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

  const handleHandlingChange = async (value: string) => {
    try {
      const newSettings: BillingSettings = {
        zeroDollarInvoiceHandling: value as 'normal' | 'finalized',
        suppressZeroDollarInvoices: settings?.suppressZeroDollarInvoices || false,
      };
      const result = await updateClientContractLineSettings(clientId, newSettings);
      if (result.success) {
        setSettings(newSettings);
        setUseDefault(false);
        toast.success("Zero-dollar invoice settings have been updated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  const handleSuppressionChange = async (checked: boolean) => {
    try {
      const newSettings: BillingSettings = {
        zeroDollarInvoiceHandling: settings?.zeroDollarInvoiceHandling || 'normal',
        suppressZeroDollarInvoices: checked,
      };
      const result = await updateClientContractLineSettings(clientId, newSettings);
      if (result.success) {
        setSettings(newSettings);
        setUseDefault(false);
        toast.success("Zero-dollar invoice settings have been updated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  const handleUseDefaultChange = async (checked: boolean) => {
    try {
      if (checked) {
        // Remove client override
        const result = await updateClientContractLineSettings(clientId, null);
        if (result.success) {
          setSettings(null);
          setUseDefault(true);
          toast.success("Client will now use default zero-dollar invoice settings.");
        }
      } else {
        // Create client override with current settings
        const newSettings: BillingSettings = {
          zeroDollarInvoiceHandling: settings?.zeroDollarInvoiceHandling || 'normal',
          suppressZeroDollarInvoices: settings?.suppressZeroDollarInvoices || false,
        };
        const result = await updateClientContractLineSettings(clientId, newSettings);
        if (result.success) {
          setSettings(newSettings);
          setUseDefault(false);
          toast.success("Client-specific zero-dollar invoice settings enabled.");
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update settings");
    }
  };

  const handlingOptions = [
    { value: 'normal', label: 'Create as Draft' },
    { value: 'finalized', label: 'Create and Finalize' }
  ];

  return (
    <div className="mt-6">
      <div>
        <Text as="div" size="3" mb="4" weight="medium" className="text-gray-900">
          Zero-Dollar Invoice Settings
        </Text>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="use-default"
              checked={useDefault}
              onCheckedChange={handleUseDefaultChange}
            />
            <div className="space-y-1">
              <Label htmlFor="use-default">Use Default Settings</Label>
              <p className="text-sm text-muted-foreground">
                Use the system-wide default settings for zero-dollar invoices
              </p>
            </div>
          </div>

          <div className={useDefault ? 'opacity-50 pointer-events-none' : ''}>
            <div className="space-y-2">
              <CustomSelect
                id="zero-dollar-invoice-handling"
                options={handlingOptions}
                value={settings?.zeroDollarInvoiceHandling || 'normal'}
                onValueChange={handleHandlingChange}
                placeholder="Select handling option"
                label="Invoice Handling"
                disabled={useDefault}
              />
              <p className="text-sm text-muted-foreground">
                Choose how zero-dollar invoices should be handled when generated
              </p>
            </div>

            <div className="flex items-center space-x-2 mt-4">
              <Switch
                id="suppress"
                checked={settings?.suppressZeroDollarInvoices || false}
                onCheckedChange={handleSuppressionChange}
                disabled={useDefault}
              />
              <div className="space-y-1">
                <Label htmlFor="suppress">Suppress Empty Invoices</Label>
                <p className="text-sm text-muted-foreground">
                  Skip creation of invoices with no line items
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientZeroDollarInvoiceSettings;
