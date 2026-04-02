import React from 'react';
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import toast from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from "@alga-psa/billing/actions";
import type { BillingSettings } from "@alga-psa/billing/actions";
import { CURRENCY_OPTIONS } from '@alga-psa/core';

const DefaultCurrencySettings = (): React.JSX.Element => {
  const [settings, setSettings] = React.useState<BillingSettings>({
    zeroDollarInvoiceHandling: 'normal',
    suppressZeroDollarInvoices: false,
    defaultCurrencyCode: 'USD',
  });

  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        const currentSettings = await getDefaultBillingSettings();
        setSettings(currentSettings);
      } catch (error) {
        handleError(error, 'Failed to load settings');
      }
    };

    loadSettings();
  }, []);

  const handleCurrencyChange = async (value: string) => {
    try {
      const newSettings = {
        ...settings,
        defaultCurrencyCode: value,
      };
      const result = await updateDefaultBillingSettings(newSettings);
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (result.success) {
        setSettings(newSettings);
        toast.success("Default currency has been updated.");
      }
    } catch (error) {
      handleError(error, 'Failed to save settings');
    }
  };

  return (
    <CustomSelect
      id="default-currency-code"
      options={CURRENCY_OPTIONS}
      value={settings.defaultCurrencyCode || 'USD'}
      onValueChange={handleCurrencyChange}
      placeholder="Select currency"
      label="Currency"
      className="!w-fit"
    />
  );
};

export default DefaultCurrencySettings;
