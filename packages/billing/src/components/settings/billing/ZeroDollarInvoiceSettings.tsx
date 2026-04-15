import React from 'react';
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { Switch } from "@alga-psa/ui/components/Switch";
import { Label } from "@alga-psa/ui/components/Label";
import toast from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from "@alga-psa/billing/actions";
import type { BillingSettings } from "@alga-psa/billing/actions";

const ZeroDollarInvoiceSettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/billing-settings');
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
        handleError(error, t('general.zeroDollar.errors.load', { defaultValue: 'Failed to load settings' }));
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
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (result.success) {
        setSettings(newSettings);
        toast.success(t('general.zeroDollar.toast.updated', {
          defaultValue: 'Zero-dollar invoice settings have been updated.'
        }));
      }
    } catch (error) {
      handleError(error, t('general.zeroDollar.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  const handleSuppressionChange = async (checked: boolean) => {
    try {
      const newSettings = {
        ...settings,
        suppressZeroDollarInvoices: checked,
      };
      const result = await updateDefaultBillingSettings(newSettings);
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (result.success) {
        setSettings(newSettings);
        toast.success(t('general.zeroDollar.toast.updated', {
          defaultValue: 'Zero-dollar invoice settings have been updated.'
        }));
      }
    } catch (error) {
      handleError(error, t('general.zeroDollar.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  const handlingOptions = [
    {
      value: 'normal',
      label: t('general.zeroDollar.options.draft', { defaultValue: 'Create as Draft' })
    },
    {
      value: 'finalized',
      label: t('general.zeroDollar.options.finalized', { defaultValue: 'Create and Finalize' })
    }
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <CustomSelect
          id="zero-dollar-invoice-handling"
          options={handlingOptions}
          value={settings.zeroDollarInvoiceHandling}
          onValueChange={handleHandlingChange}
          placeholder={t('general.zeroDollar.fields.handling.placeholder', {
            defaultValue: 'Select handling option'
          })}
          label={t('general.zeroDollar.fields.handling.label', {
            defaultValue: 'Invoice Handling'
          })}
          className="!w-fit"
        />
        <p className="text-sm text-muted-foreground">
          {t('general.zeroDollar.fields.handling.help', {
            defaultValue: 'Choose how zero-dollar invoices should be handled when generated'
          })}
        </p>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="suppress"
          checked={settings.suppressZeroDollarInvoices}
          onCheckedChange={handleSuppressionChange}
        />
        <div className="space-y-1">
          <Label htmlFor="suppress">
            {t('general.zeroDollar.fields.suppress.label', { defaultValue: 'Suppress Empty Invoices' })}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('general.zeroDollar.fields.suppress.help', {
              defaultValue: 'Skip creation of invoices with no line items'
            })}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ZeroDollarInvoiceSettings;
