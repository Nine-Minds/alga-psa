import React from 'react';
import CurrencyPicker from "@alga-psa/ui/components/CurrencyPicker";
import toast from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from "../../../actions/billingSettingsActions";
import type { BillingSettings } from "../../../actions/billingSettingsActions";

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
      const result = await updateDefaultBillingSettings({ defaultCurrencyCode: value });
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (result.success) {
        setSettings((current) => ({ ...current, defaultCurrencyCode: value }));
        if (
          typeof result.propagatedClientCount === 'number' &&
          typeof result.preservedClientCount === 'number'
        ) {
          toast.success(
            t('general.currency.toast.propagated', {
              defaultValue:
                'Default currency changed to {{currency}}. {{updated}} client defaults updated; {{preserved}} client overrides preserved.',
              currency: result.currencyCode ?? value,
              updated: result.propagatedClientCount,
              preserved: result.preservedClientCount,
            }),
          );
        } else {
          toast.success(t('general.currency.toast.updated', { defaultValue: 'Default currency has been updated.' }));
        }
      }
    } catch (error) {
      handleError(error, t('general.currency.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  return (
    <div className="space-y-2">
      <CurrencyPicker
        id="default-currency-code"
        value={settings.defaultCurrencyCode || 'USD'}
        onValueChange={handleCurrencyChange}
        placeholder={t('general.currency.fields.currency.placeholder', { defaultValue: 'Select currency' })}
        label={t('general.currency.fields.currency.label', { defaultValue: 'Currency' })}
        className="!w-fit"
      />
      <p className="max-w-prose text-xs text-muted-foreground" id="default-currency-propagation-note">
        {t('general.currency.propagationNote', {
          defaultValue:
            'Changing this updates clients currently using the previous default currency. Clients with a different currency are preserved, and existing documents and templates do not change.',
        })}
      </p>
    </div>
  );
};

export default DefaultCurrencySettings;
