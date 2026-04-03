import React, { useEffect, useState } from 'react';
import { Text } from '@radix-ui/themes';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import {
  getClientContractLineSettingsAsync,
  updateClientContractLineSettingsAsync
} from "../../lib/billingHelpers";
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// Local type definition to avoid circular dependency
interface BillingSettings {
  zeroDollarInvoiceHandling?: 'normal' | 'finalized';
  suppressZeroDollarInvoices?: boolean;
}

interface ClientZeroDollarInvoiceSettingsProps {
  clientId: string;
}

const ClientZeroDollarInvoiceSettings: React.FC<ClientZeroDollarInvoiceSettingsProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/clients');
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [useDefault, setUseDefault] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const clientSettings = await getClientContractLineSettingsAsync(clientId);
        if (clientSettings) {
          setSettings(clientSettings);
          setUseDefault(false);
        } else {
          setUseDefault(true);
        }
      } catch (error) {
        handleError(error, t('clientZeroDollarInvoiceSettings.loadError', { defaultValue: 'Failed to load settings' }));
      }
    };

    loadSettings();
  }, [clientId, t]);

  const handleHandlingChange = async (value: string) => {
    try {
      const newSettings: BillingSettings = {
        zeroDollarInvoiceHandling: value as 'normal' | 'finalized',
        suppressZeroDollarInvoices: settings?.suppressZeroDollarInvoices || false,
      };
      const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
      if (result.success) {
        setSettings(newSettings);
        setUseDefault(false);
        toast.success(t('clientZeroDollarInvoiceSettings.updatedSuccess', { defaultValue: 'Zero-dollar invoice settings have been updated.' }));
      }
      } catch (error) {
      handleError(error, t('clientZeroDollarInvoiceSettings.saveError', { defaultValue: 'Failed to save settings' }));
    }
  };

  const handleSuppressionChange = async (checked: boolean) => {
    try {
      const newSettings: BillingSettings = {
        zeroDollarInvoiceHandling: settings?.zeroDollarInvoiceHandling || 'normal',
        suppressZeroDollarInvoices: checked,
      };
      const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
      if (result.success) {
        setSettings(newSettings);
        setUseDefault(false);
        toast.success(t('clientZeroDollarInvoiceSettings.updatedSuccess', { defaultValue: 'Zero-dollar invoice settings have been updated.' }));
      }
    } catch (error) {
      handleError(error, t('clientZeroDollarInvoiceSettings.saveError', { defaultValue: 'Failed to save settings' }));
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
          toast.success(t('clientZeroDollarInvoiceSettings.useDefaultSuccess', { defaultValue: 'Client will now use default zero-dollar invoice settings.' }));
        }
      } else {
        // Create client override with current settings
        const newSettings: BillingSettings = {
          zeroDollarInvoiceHandling: settings?.zeroDollarInvoiceHandling || 'normal',
          suppressZeroDollarInvoices: settings?.suppressZeroDollarInvoices || false,
        };
        const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
        if (result.success) {
          setSettings(newSettings);
          setUseDefault(false);
          toast.success(t('clientZeroDollarInvoiceSettings.clientSpecificEnabled', { defaultValue: 'Client-specific zero-dollar invoice settings enabled.' }));
        }
      }
    } catch (error) {
      handleError(error, t('clientZeroDollarInvoiceSettings.updateError', { defaultValue: 'Failed to update settings' }));
    }
  };

  const handlingOptions = [
    { value: 'normal', label: t('clientZeroDollarInvoiceSettings.handling.normal', { defaultValue: 'Create as Draft' }) },
    { value: 'finalized', label: t('clientZeroDollarInvoiceSettings.handling.finalized', { defaultValue: 'Create and Finalize' }) }
  ];

  return (
    <div className="mt-6">
      <div>
        <Text as="div" size="3" mb="4" weight="medium" className="text-gray-900">
          {t('clientZeroDollarInvoiceSettings.title', { defaultValue: 'Zero-Dollar Invoice Settings' })}
        </Text>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="use-default"
              checked={useDefault}
              onCheckedChange={handleUseDefaultChange}
            />
            <div className="space-y-1">
              <Label htmlFor="use-default">{t('clientZeroDollarInvoiceSettings.useDefault', { defaultValue: 'Use Default Settings' })}</Label>
              <p className="text-sm text-muted-foreground">
                {t('clientZeroDollarInvoiceSettings.useDefaultHelp', { defaultValue: 'Use the system-wide default settings for zero-dollar invoices' })}
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
                placeholder={t('clientZeroDollarInvoiceSettings.selectHandling', { defaultValue: 'Select handling option' })}
                label={t('clientZeroDollarInvoiceSettings.invoiceHandling', { defaultValue: 'Invoice Handling' })}
                disabled={useDefault}
              />
              <p className="text-sm text-muted-foreground">
                {t('clientZeroDollarInvoiceSettings.handlingHelp', { defaultValue: 'Choose how zero-dollar invoices should be handled when generated' })}
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
                <Label htmlFor="suppress">{t('clientZeroDollarInvoiceSettings.suppressEmptyInvoices', { defaultValue: 'Suppress Empty Invoices' })}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('clientZeroDollarInvoiceSettings.suppressEmptyHelp', { defaultValue: 'Skip creation of invoices with no line items' })}
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
