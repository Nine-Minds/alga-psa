import React from 'react';
import CustomSelect from "server/src/components/ui/CustomSelect";
import { Switch } from "server/src/components/ui/Switch";
import { Label } from "server/src/components/ui/Label";
import toast from 'react-hot-toast';
import { getDefaultBillingSettings, updateDefaultBillingSettings, type BillingSettings } from "@product/actions/billingSettingsActions";

const ZeroDollarInvoiceSettings = (): JSX.Element => {
  const [settings, setSettings] = React.useState<BillingSettings>({
    zeroDollarInvoiceHandling: 'normal',
    suppressZeroDollarInvoices: false
  });

  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        const currentSettings = await getDefaultBillingSettings();
        setSettings(currentSettings);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load settings");
      }
    };

    loadSettings();
  }, []);

  const handleHandlingChange = async (value: string) => {
    try {
      const newSettings = {
        ...settings,
        zeroDollarInvoiceHandling: value as 'normal' | 'finalized',
      };
      const result = await updateDefaultBillingSettings(newSettings);
      if (result.success) {
        setSettings(newSettings);
        toast.success("Zero-dollar invoice settings have been updated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  const handleSuppressionChange = async (checked: boolean) => {
    try {
      const newSettings = {
        ...settings,
        suppressZeroDollarInvoices: checked,
      };
      const result = await updateDefaultBillingSettings(newSettings);
      if (result.success) {
        setSettings(newSettings);
        toast.success("Zero-dollar invoice settings have been updated.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
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
          <div className="space-y-2">
            <CustomSelect
              id="zero-dollar-invoice-handling"
              options={handlingOptions}
              value={settings.zeroDollarInvoiceHandling}
              onValueChange={handleHandlingChange}
              placeholder="Select handling option"
              label="Invoice Handling"
            />
            <p className="text-sm text-muted-foreground">
              Choose how zero-dollar invoices should be handled when generated
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="suppress"
              checked={settings.suppressZeroDollarInvoices}
              onCheckedChange={handleSuppressionChange}
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
  );
};

export default ZeroDollarInvoiceSettings;