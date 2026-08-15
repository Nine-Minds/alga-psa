import React from 'react';
import { Switch } from "@alga-psa/ui/components/Switch";
import { Label } from "@alga-psa/ui/components/Label";
import { Checkbox } from "@alga-psa/ui/components/Checkbox";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import toast from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from "../../../actions/billingSettingsActions";
import type { BillingSettings } from "../../../actions/billingSettingsActions";
import { getServiceTypesForSelection } from "../../../actions/serviceActions";

interface ServiceTypeOption {
  id: string;
  name: string;
  is_standard: boolean;
}

const CreditDrawdownSettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/billing-settings');
  const [settings, setSettings] = React.useState<BillingSettings>({
    zeroDollarInvoiceHandling: 'normal',
    suppressZeroDollarInvoices: false,
    creditAutoApplyEnabled: true,
    creditApplicationOrder: 'expiration_first',
    creditServiceTypeRestrictionMode: 'all',
    creditEligibleServiceTypeIds: null,
  });
  const [serviceTypes, setServiceTypes] = React.useState<ServiceTypeOption[]>([]);

  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        const [currentSettings, serviceTypeResult] = await Promise.all([
          getDefaultBillingSettings(),
          getServiceTypesForSelection(),
        ]);
        setSettings(currentSettings);
        if (Array.isArray(serviceTypeResult)) {
          setServiceTypes(serviceTypeResult);
        }
      } catch (error) {
        handleError(error, t('general.creditDrawdown.errors.load', { defaultValue: 'Failed to load settings' }));
      }
    };

    loadSettings();
  }, [t]);

  const persist = async (data: Partial<BillingSettings>) => {
    const result = await updateDefaultBillingSettings(data);
    if (isActionPermissionError(result)) {
      handleError(result.permissionError);
      return false;
    }
    if (result.success) {
      toast.success(t('general.creditDrawdown.toast.updated', {
        defaultValue: 'Credit draw-down settings have been updated.'
      }));
      return true;
    }
    return false;
  };

  const handleAutoApplyChange = async (checked: boolean) => {
    try {
      if (await persist({ creditAutoApplyEnabled: checked })) {
        setSettings((prev) => ({ ...prev, creditAutoApplyEnabled: checked }));
      }
    } catch (error) {
      handleError(error, t('general.creditDrawdown.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  const handleOrderChange = async (value: string) => {
    try {
      const order = value as BillingSettings['creditApplicationOrder'];
      if (await persist({ creditApplicationOrder: order })) {
        setSettings((prev) => ({ ...prev, creditApplicationOrder: order }));
      }
    } catch (error) {
      handleError(error, t('general.creditDrawdown.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  const handleModeChange = async (value: string) => {
    try {
      if (value === 'all') {
        if (await persist({ creditServiceTypeRestrictionMode: 'all' })) {
          setSettings((prev) => ({
            ...prev,
            creditServiceTypeRestrictionMode: 'all',
            creditEligibleServiceTypeIds: null,
          }));
        }
      } else {
        // Enter "Only selected types" without persisting yet: a restricted mode
        // must carry a non-empty ids list, so it is committed together with the
        // first selection below.
        setSettings((prev) => ({
          ...prev,
          creditServiceTypeRestrictionMode: 'restricted',
        }));
      }
    } catch (error) {
      handleError(error, t('general.creditDrawdown.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  const handleServiceTypeToggle = async (serviceTypeId: string, checked: boolean) => {
    try {
      const current = settings.creditEligibleServiceTypeIds ?? [];
      const next = checked
        ? Array.from(new Set([...current, serviceTypeId]))
        : current.filter((id) => id !== serviceTypeId);
      if (next.length === 0) {
        // Deselecting the last type returns to "All service types".
        if (await persist({ creditServiceTypeRestrictionMode: 'all' })) {
          setSettings((prev) => ({
            ...prev,
            creditServiceTypeRestrictionMode: 'all',
            creditEligibleServiceTypeIds: null,
          }));
        }
        return;
      }
      if (await persist({ creditServiceTypeRestrictionMode: 'restricted', creditEligibleServiceTypeIds: next })) {
        setSettings((prev) => ({
          ...prev,
          creditServiceTypeRestrictionMode: 'restricted',
          creditEligibleServiceTypeIds: next,
        }));
      }
    } catch (error) {
      handleError(error, t('general.creditDrawdown.errors.save', { defaultValue: 'Failed to save settings' }));
    }
  };

  const restrictionMode = settings.creditServiceTypeRestrictionMode === 'restricted' ? 'restricted' : 'all';
  const selectedIds = settings.creditEligibleServiceTypeIds ?? [];

  const orderOptions = [
    { value: 'expiration_first', label: t('general.creditDrawdown.options.expirationFirst', { defaultValue: 'Expiring soonest first' }) },
    { value: 'oldest_first', label: t('general.creditDrawdown.options.oldestFirst', { defaultValue: 'Oldest credit first' }) },
    { value: 'newest_first', label: t('general.creditDrawdown.options.newestFirst', { defaultValue: 'Newest credit first' }) },
  ];

  const restrictionModeOptions = [
    { value: 'all', label: t('general.creditDrawdown.fields.serviceTypes.mode.all', { defaultValue: 'All service types' }) },
    { value: 'restricted', label: t('general.creditDrawdown.fields.serviceTypes.mode.restricted', { defaultValue: 'Only selected types' }) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Switch
          id="credit-auto-apply-enabled"
          checked={settings.creditAutoApplyEnabled ?? true}
          onCheckedChange={handleAutoApplyChange}
        />
        <div className="space-y-1">
          <Label htmlFor="credit-auto-apply-enabled">
            {t('general.creditDrawdown.fields.autoApply.label', {
              defaultValue: 'Automatically apply credit at finalization'
            })}
          </Label>
          <p className="text-sm text-muted-foreground">
            {t('general.creditDrawdown.fields.autoApply.help', {
              defaultValue: 'When enabled, available credit is applied automatically when an invoice is finalized'
            })}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <CustomSelect
          id="credit-application-order"
          options={orderOptions}
          value={settings.creditApplicationOrder ?? 'expiration_first'}
          onValueChange={handleOrderChange}
          placeholder={t('general.creditDrawdown.fields.order.placeholder', {
            defaultValue: 'Select credit order'
          })}
          label={t('general.creditDrawdown.fields.order.label', {
            defaultValue: 'Credit application order'
          })}
          className="!w-fit"
        />
        <p className="text-sm text-muted-foreground">
          {t('general.creditDrawdown.fields.order.help', {
            defaultValue: 'Choose the order in which credits are consumed'
          })}
        </p>
      </div>

      <div className="space-y-2">
        <CustomSelect
          id="credit-service-type-restriction-mode"
          options={restrictionModeOptions}
          value={restrictionMode}
          onValueChange={handleModeChange}
          label={t('general.creditDrawdown.fields.serviceTypes.label', {
            defaultValue: 'Eligible service types'
          })}
          className="!w-fit"
        />
        <p className="text-sm text-muted-foreground">
          {t('general.creditDrawdown.fields.serviceTypes.help', {
            defaultValue: 'Choose whether credit can be applied to all charges or only to charges for the selected service types.'
          })}
        </p>
        {restrictionMode === 'restricted' && (
          <div className="space-y-2 rounded-md border border-[rgb(var(--color-border-200))] p-3">
            {serviceTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('general.creditDrawdown.fields.serviceTypes.empty', {
                  defaultValue: 'No service types configured.'
                })}
              </p>
            ) : (
              serviceTypes.map((serviceType) => (
                <Checkbox
                  key={serviceType.id}
                  id={`credit-eligible-service-type-${serviceType.id}`}
                  label={serviceType.name}
                  checked={selectedIds.includes(serviceType.id)}
                  onChange={(event) => handleServiceTypeToggle(serviceType.id, event.target.checked)}
                />
              ))
            )}
            <p className="text-xs text-muted-foreground">
              {t('general.creditDrawdown.fields.serviceTypes.restricted', {
                defaultValue: 'Credit is restricted to the selected service types.'
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditDrawdownSettings;
