import React, { useEffect, useState } from 'react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import toast from 'react-hot-toast';
import { getCompanyBillingSettings, updateCompanyBillingSettings, type BillingSettings } from "server/src/lib/actions/billingSettingsActions";

interface CompanyZeroDollarInvoiceSettingsProps {
  companyId: string;
}

const CompanyZeroDollarInvoiceSettings: React.FC<CompanyZeroDollarInvoiceSettingsProps> = ({ companyId }) => {
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [useDefault, setUseDefault] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const companySettings = await getCompanyBillingSettings(companyId);
        if (companySettings) {
          setSettings(companySettings);
          setUseDefault(false);
        } else {
          setUseDefault(true);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load settings");
      }
    };

    loadSettings();
  }, [companyId]);

  const handleHandlingChange = async (value: string) => {
    try {
      const newSettings: BillingSettings = {
        zeroDollarInvoiceHandling: value as 'normal' | 'finalized',
        suppressZeroDollarInvoices: settings?.suppressZeroDollarInvoices || false,
      };
      const result = await updateCompanyBillingSettings(companyId, newSettings);
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
      const result = await updateCompanyBillingSettings(companyId, newSettings);
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
        // Remove company override
        const result = await updateCompanyBillingSettings(companyId, null);
        if (result.success) {
          setSettings(null);
          setUseDefault(true);
          toast.success("Company will now use default zero-dollar invoice settings.");
        }
      } else {
        // Create company override with current settings
        const newSettings: BillingSettings = {
          zeroDollarInvoiceHandling: settings?.zeroDollarInvoiceHandling || 'normal',
          suppressZeroDollarInvoices: settings?.suppressZeroDollarInvoices || false,
        };
        const result = await updateCompanyBillingSettings(companyId, newSettings);
        if (result.success) {
          setSettings(newSettings);
          setUseDefault(false);
          toast.success("Company-specific zero-dollar invoice settings enabled.");
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
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">Zero-Dollar Invoice Settings</h3>
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

export default CompanyZeroDollarInvoiceSettings;