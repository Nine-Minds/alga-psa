import React, { useEffect, useState } from 'react';
import { Text } from '@radix-ui/themes';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getClientContractLineSettingsAsync,
  updateClientContractLineSettingsAsync,
  getServiceTypesForSelectionAsync,
} from "../../lib/billingHelpers";

// Local type definition to avoid circular dependency
interface BillingSettings {
  zeroDollarInvoiceHandling?: 'normal' | 'finalized';
  suppressZeroDollarInvoices?: boolean;
  enableCreditExpiration?: boolean;
  creditExpirationDays?: number;
  creditExpirationNotificationDays?: number[];
  creditAutoApplyEnabled?: boolean;
  creditApplicationOrder?: 'expiration_first' | 'oldest_first' | 'newest_first';
  creditEligibleServiceTypeIds?: string[] | null;
}

interface ClientCreditDrawdownSettingsProps {
  clientId: string;
}

const ClientCreditDrawdownSettings: React.FC<ClientCreditDrawdownSettingsProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/clients');
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [useDefault, setUseDefault] = useState(true);
  const [serviceTypes, setServiceTypes] = useState<Array<{ id: string; name: string; is_standard: boolean }>>([]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [clientSettings, serviceTypeResult] = await Promise.all([
          getClientContractLineSettingsAsync(clientId),
          getServiceTypesForSelectionAsync(),
        ]);
        if (clientSettings) {
          setSettings(clientSettings);
          setUseDefault(false);
        } else {
          setSettings(null);
          setUseDefault(true);
        }
        if (Array.isArray(serviceTypeResult)) {
          setServiceTypes(serviceTypeResult);
        }
      } catch (error) {
        handleError(error, t('clientCreditDrawdownSettings.loadError', { defaultValue: 'Failed to load settings' }));
      }
    };

    loadSettings();
  }, [clientId, t]);

  const handleAutoApplyChange = async (checked: boolean) => {
    try {
      const newSettings: BillingSettings = {
        zeroDollarInvoiceHandling: settings?.zeroDollarInvoiceHandling || 'normal',
        suppressZeroDollarInvoices: settings?.suppressZeroDollarInvoices || false,
        enableCreditExpiration: settings?.enableCreditExpiration ?? true,
        creditExpirationDays: settings?.creditExpirationDays ?? 365,
        creditExpirationNotificationDays: settings?.creditExpirationNotificationDays ?? [30, 7, 1],
        creditAutoApplyEnabled: checked,
      };
      const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
      if (result.success) {
        setSettings((prev) => ({ ...prev, creditAutoApplyEnabled: checked }));
        setUseDefault(false);
        toast.success(t('clientCreditDrawdownSettings.updatedSuccess', { defaultValue: 'Credit draw-down settings have been updated.' }));
      }
    } catch (error) {
      handleError(error, t('clientCreditDrawdownSettings.saveError', { defaultValue: 'Failed to save settings' }));
    }
  };

  const handleOrderChange = async (value: string) => {
    try {
      const order = value as 'expiration_first' | 'oldest_first' | 'newest_first';
      const newSettings: BillingSettings = {
        zeroDollarInvoiceHandling: settings?.zeroDollarInvoiceHandling || 'normal',
        suppressZeroDollarInvoices: settings?.suppressZeroDollarInvoices || false,
        enableCreditExpiration: settings?.enableCreditExpiration ?? true,
        creditExpirationDays: settings?.creditExpirationDays ?? 365,
        creditExpirationNotificationDays: settings?.creditExpirationNotificationDays ?? [30, 7, 1],
        creditApplicationOrder: order,
      };
      const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
      if (result.success) {
        setSettings((prev) => ({ ...prev, creditApplicationOrder: order }));
        setUseDefault(false);
        toast.success(t('clientCreditDrawdownSettings.updatedSuccess', { defaultValue: 'Credit draw-down settings have been updated.' }));
      }
    } catch (error) {
      handleError(error, t('clientCreditDrawdownSettings.saveError', { defaultValue: 'Failed to save settings' }));
    }
  };

  const handleServiceTypeToggle = async (serviceTypeId: string, checked: boolean) => {
    try {
      const current = settings?.creditEligibleServiceTypeIds ?? [];
      const next = checked
        ? Array.from(new Set([...current, serviceTypeId]))
        : current.filter((id) => id !== serviceTypeId);
      const nextValue = next.length === 0 ? null : next;
      const newSettings: BillingSettings = {
        zeroDollarInvoiceHandling: settings?.zeroDollarInvoiceHandling || 'normal',
        suppressZeroDollarInvoices: settings?.suppressZeroDollarInvoices || false,
        enableCreditExpiration: settings?.enableCreditExpiration ?? true,
        creditExpirationDays: settings?.creditExpirationDays ?? 365,
        creditExpirationNotificationDays: settings?.creditExpirationNotificationDays ?? [30, 7, 1],
        creditEligibleServiceTypeIds: nextValue,
      };
      const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
      if (result.success) {
        setSettings((prev) => ({ ...prev, creditEligibleServiceTypeIds: nextValue }));
        setUseDefault(false);
        toast.success(t('clientCreditDrawdownSettings.updatedSuccess', { defaultValue: 'Credit draw-down settings have been updated.' }));
      }
    } catch (error) {
      handleError(error, t('clientCreditDrawdownSettings.saveError', { defaultValue: 'Failed to save settings' }));
    }
  };

  const handleUseDefaultChange = async (checked: boolean) => {
    try {
      if (checked) {
        const result = await updateClientContractLineSettingsAsync(clientId, null);
        if (result.success) {
          setSettings(null);
          setUseDefault(true);
          toast.success(t('clientCreditDrawdownSettings.useDefaultSuccess', { defaultValue: 'Client will now use default credit draw-down settings.' }));
        }
      } else {
        const newSettings: BillingSettings = {
          zeroDollarInvoiceHandling: settings?.zeroDollarInvoiceHandling || 'normal',
          suppressZeroDollarInvoices: settings?.suppressZeroDollarInvoices || false,
          enableCreditExpiration: settings?.enableCreditExpiration ?? true,
          creditExpirationDays: settings?.creditExpirationDays ?? 365,
          creditExpirationNotificationDays: settings?.creditExpirationNotificationDays ?? [30, 7, 1],
          creditAutoApplyEnabled: settings?.creditAutoApplyEnabled ?? true,
          creditApplicationOrder: settings?.creditApplicationOrder ?? 'expiration_first',
          creditEligibleServiceTypeIds: settings?.creditEligibleServiceTypeIds ?? null,
        };
        const result = await updateClientContractLineSettingsAsync(clientId, newSettings);
        if (result.success) {
          setSettings(newSettings);
          setUseDefault(false);
          toast.success(t('clientCreditDrawdownSettings.clientSpecificEnabled', { defaultValue: 'Client-specific credit draw-down settings enabled.' }));
        }
      }
    } catch (error) {
      handleError(error, t('clientCreditDrawdownSettings.updateError', { defaultValue: 'Failed to update settings' }));
    }
  };

  const orderOptions = [
    { value: 'expiration_first', label: t('clientCreditDrawdownSettings.order.expirationFirst', { defaultValue: 'Expiring soonest first' }) },
    { value: 'oldest_first', label: t('clientCreditDrawdownSettings.order.oldestFirst', { defaultValue: 'Oldest credit first' }) },
    { value: 'newest_first', label: t('clientCreditDrawdownSettings.order.newestFirst', { defaultValue: 'Newest credit first' }) },
  ];

  const selectedIds = settings?.creditEligibleServiceTypeIds ?? [];

  return (
    <div className="mt-6">
      <div>
        <Text as="div" size="3" mb="4" weight="medium" className="text-gray-900">
          {t('clientCreditDrawdownSettings.title', { defaultValue: 'Credit Draw-Down Settings' })}
        </Text>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="use-default-credit-drawdown"
              checked={useDefault}
              onCheckedChange={handleUseDefaultChange}
            />
            <div className="space-y-1">
              <Label htmlFor="use-default-credit-drawdown">{t('clientCreditDrawdownSettings.useDefault', { defaultValue: 'Use Default Settings' })}</Label>
              <p className="text-sm text-muted-foreground">
                {t('clientCreditDrawdownSettings.useDefaultHelp', { defaultValue: 'Use the system-wide default settings for credit draw-down' })}
              </p>
            </div>
          </div>

          <div className={useDefault ? 'opacity-50 pointer-events-none' : ''}>
            <div className="flex items-center space-x-2 mb-4">
              <Switch
                id="client-credit-auto-apply-enabled"
                checked={settings?.creditAutoApplyEnabled ?? true}
                onCheckedChange={handleAutoApplyChange}
                disabled={useDefault}
              />
              <div className="space-y-1">
                <Label htmlFor="client-credit-auto-apply-enabled">
                  {t('clientCreditDrawdownSettings.autoApply', { defaultValue: 'Automatically apply credit at finalization' })}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('clientCreditDrawdownSettings.autoApplyHelp', { defaultValue: 'When enabled, available credit is applied automatically when an invoice is finalized' })}
                </p>
              </div>
            </div>

            <div className="space-y-2 mb-4">
              <CustomSelect
                id="client-credit-application-order"
                options={orderOptions}
                value={settings?.creditApplicationOrder ?? 'expiration_first'}
                onValueChange={handleOrderChange}
                placeholder={t('clientCreditDrawdownSettings.selectOrder', { defaultValue: 'Select credit order' })}
                label={t('clientCreditDrawdownSettings.orderLabel', { defaultValue: 'Credit application order' })}
                disabled={useDefault}
              />
              <p className="text-sm text-muted-foreground">
                {t('clientCreditDrawdownSettings.orderHelp', { defaultValue: 'Choose the order in which credits are consumed' })}
              </p>
            </div>

            <div className="space-y-2">
              <Label>{t('clientCreditDrawdownSettings.serviceTypesLabel', { defaultValue: 'Eligible service types' })}</Label>
              <p className="text-sm text-muted-foreground">
                {t('clientCreditDrawdownSettings.serviceTypesHelp', { defaultValue: 'Restrict credit application to the selected service types. Leave all unchecked to apply credit to all charges.' })}
              </p>
              <div className="space-y-2 rounded-md border border-[rgb(var(--color-border-200))] p-3">
                {serviceTypes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('clientCreditDrawdownSettings.noServiceTypes', { defaultValue: 'No service types configured.' })}
                  </p>
                ) : (
                  serviceTypes.map((serviceType) => (
                    <Checkbox
                      key={serviceType.id}
                      id={`client-credit-eligible-service-type-${serviceType.id}`}
                      label={serviceType.name}
                      checked={selectedIds.includes(serviceType.id)}
                      disabled={useDefault}
                      onChange={(event) => handleServiceTypeToggle(serviceType.id, event.target.checked)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientCreditDrawdownSettings;
