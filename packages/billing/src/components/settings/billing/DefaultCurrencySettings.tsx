import React from 'react';
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import toast from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from "@alga-psa/billing/actions";
import type { BillingSettings } from "@alga-psa/billing/actions";
import { CURRENCY_OPTIONS } from '@alga-psa/core';

const DefaultCurrencySettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/billing-settings');
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
        handleError(error, t('general.currency.errors.load', { defaultValue: 'Failed to load settings' }));
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
        toast.success(t('general.currency.toast.updated', { defaultValue: 'Default currency has been updated.' }));
      }
    } catch (error) {
      handleError(error, t('general.currency.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  return (
    <CustomSelect
      id="default-currency-code"
      options={CURRENCY_OPTIONS}
      value={settings.defaultCurrencyCode || 'USD'}
      onValueChange={handleCurrencyChange}
      placeholder={t('general.currency.fields.currency.placeholder', { defaultValue: 'Select currency' })}
      label={t('general.currency.fields.currency.label', { defaultValue: 'Currency' })}
      className="!w-fit"
    />
  );
};

export default DefaultCurrencySettings;
