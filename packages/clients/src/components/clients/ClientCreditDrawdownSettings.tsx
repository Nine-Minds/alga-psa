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
  getResolvedCreditDrawdownPolicyAsync,
} from "../../lib/billingHelpers";

// Local type definition to avoid circular dependency
interface BillingSettings {
  zeroDollarInvoiceHandling?: 'normal' | 'finalized';
  suppressZeroDollarInvoices?: boolean;
  enableCreditExpiration?: boolean;
  creditExpirationDays?: number;
  creditExpirationNotificationDays?: number[];
  creditAutoApplyEnabled?: boolean | null;
  creditApplicationOrder?: 'expiration_first' | 'oldest_first' | 'newest_first' | null;
  creditEligibleServiceTypeIds?: string[] | null;
}

// The resolved tenant draw-down policy, used to populate the disabled "Use
// Default" controls and to seed the custom form when the user opts in.
interface ResolvedDrawdownPolicy {
  autoApplyEnabled: boolean;
  applicationOrder: 'expiration_first' | 'oldest_first' | 'newest_first';
  eligibleServiceTypeIds: string[] | null;
}

// A client is "using defaults" when none of the three draw-down fields carry a
// client-level override. This keys off the fields being null/undefined, not off
// the row existing, so a row that keeps unrelated billing overrides (zero-dollar,
// expiration, external credit) but has cleared draw-down fields still reads as
// inheriting.
function hasDrawdownOverrides(settings: BillingSettings | null): boolean {
  if (!settings) return false;
  return (
    settings.creditAutoApplyEnabled != null ||
    settings.creditApplicationOrder != null ||
    settings.creditEligibleServiceTypeIds != null
  );
}

interface ClientCreditDrawdownSettingsProps {
  clientId: string;
}

const ClientCreditDrawdownSettings: React.FC<ClientCreditDrawdownSettingsProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/clients');
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [resolvedPolicy, setResolvedPolicy] = useState<ResolvedDrawdownPolicy | null>(null);
  const [useDefault, setUseDefault] = useState(true);
  const [serviceTypes, setServiceTypes] = useState<Array<{ id: string; name: string; is_standard: boolean }>>([]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [clientSettings, serviceTypeResult, resolved] = await Promise.all([
          getClientContractLineSettingsAsync(clientId),
          getServiceTypesForSelectionAsync(),
          getResolvedCreditDrawdownPolicyAsync(clientId),
        ]);
        if (clientSettings) {
          setSettings(clientSettings);
          setUseDefault(!hasDrawdownOverrides(clientSettings));
        } else {
          setSettings(null);
          setUseDefault(true);
        }
        setResolvedPolicy(resolved);
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
      // Send only the field being changed; the shared update path leaves every
      // unrelated override untouched.
      const result = await updateClientContractLineSettingsAsync(clientId, {
        creditAutoApplyEnabled: checked,
      });
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
      // Send only the field being changed; the shared update path leaves every
      // unrelated override untouched.
      const result = await updateClientContractLineSettingsAsync(clientId, {
        creditApplicationOrder: order,
      });
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
      // Send only the field being changed; the shared update path leaves every
      // unrelated override untouched.
      const result = await updateClientContractLineSettingsAsync(clientId, {
        creditEligibleServiceTypeIds: nextValue,
      });
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
        // Revert only the three draw-down fields to inherit; the shared update
        // path nulls them while leaving every unrelated override (zero-dollar
        // handling, expiration, external credit) intact.
        const result = await updateClientContractLineSettingsAsync(clientId, {
          creditAutoApplyEnabled: null,
          creditApplicationOrder: null,
          creditEligibleServiceTypeIds: null,
        });
        if (result.success) {
          setSettings(null);
          setUseDefault(true);
          // The resolved policy now follows the tenant defaults; refresh it so
          // the disabled controls keep reflecting the tenant's actual values.
          try {
            const resolved = await getResolvedCreditDrawdownPolicyAsync(clientId);
            setResolvedPolicy(resolved);
          } catch (error) {
            handleError(error, t('clientCreditDrawdownSettings.loadError', { defaultValue: 'Failed to load settings' }));
          }
          toast.success(t('clientCreditDrawdownSettings.useDefaultSuccess', { defaultValue: 'Client will now use default credit draw-down settings.' }));
        }
      } else {
        // Enable client-specific draw-down seeded from the *resolved* policy,
        // so flipping to custom is a no-op on the effective policy until the
        // user actually edits a field. Never touch unrelated overrides.
        const seed = resolvedPolicy ?? {
          autoApplyEnabled: true,
          applicationOrder: 'expiration_first',
          eligibleServiceTypeIds: null,
        };
        const newSettings: BillingSettings = {
          creditAutoApplyEnabled: seed.autoApplyEnabled,
          creditApplicationOrder: seed.applicationOrder,
          creditEligibleServiceTypeIds: seed.eligibleServiceTypeIds,
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

  // When "Use Default Settings" is active, the disabled controls show the
  // resolved tenant policy (not hardcoded placeholders); when custom, they show
  // the client's own overrides.
  const effectiveAutoApply = useDefault
    ? (resolvedPolicy?.autoApplyEnabled ?? true)
    : (settings?.creditAutoApplyEnabled ?? true);
  const effectiveOrder = useDefault
    ? (resolvedPolicy?.applicationOrder ?? 'expiration_first')
    : (settings?.creditApplicationOrder ?? 'expiration_first');
  const effectiveEligibleIds = useDefault
    ? (resolvedPolicy?.eligibleServiceTypeIds ?? [])
    : (settings?.creditEligibleServiceTypeIds ?? []);

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
                checked={effectiveAutoApply}
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
                value={effectiveOrder}
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
                      checked={effectiveEligibleIds.includes(serviceType.id)}
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
