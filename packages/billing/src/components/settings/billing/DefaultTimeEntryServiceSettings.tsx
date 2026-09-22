'use client';

import React from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import toast from 'react-hot-toast';
import {
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from '../../../actions/billingSettingsActions';
import { getServices } from '../../../actions/serviceActions';

/**
 * Tenant-wide fallback service used when a technician adds time to a ticket and
 * the client has no default of its own. Options come from the same hourly
 * service catalog the time-entry selector uses.
 */
const DefaultTimeEntryServiceSettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/billing-settings');
  const [serviceId, setServiceId] = React.useState<string>('');
  const [options, setOptions] = React.useState<Array<{ value: string; label: string }>>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      try {
        const [settings, servicesResult] = await Promise.all([
          getDefaultBillingSettings(),
          getServices(1, 999, { item_kind: 'service', is_active: true, billing_method: 'hourly' }),
        ]);
        if (cancelled) return;

        if (!isActionMessageError(settings) && !isActionPermissionError(settings)) {
          setServiceId(settings.defaultTimeEntryServiceId ?? '');
        }

        const services =
          servicesResult && !isActionMessageError(servicesResult) && !isActionPermissionError(servicesResult)
            ? servicesResult.services
            : [];
        setOptions(services.map((service) => ({ value: service.service_id, label: service.service_name })));
      } catch (error) {
        if (cancelled) return;
        handleError(error, t('general.timeEntryService.errors.load', {
          defaultValue: 'Failed to load default time-entry service',
        }));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleChange = async (value: string) => {
    try {
      // Empty string = clear the default and fall back to no auto-selection.
      const result = await updateDefaultBillingSettings({
        defaultTimeEntryServiceId: value || null,
      });
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (isActionMessageError(result)) {
        handleError(result.actionError);
        return;
      }
      if (result.success) {
        setServiceId(value);
        toast.success(t('general.timeEntryService.toast.updated', {
          defaultValue: 'Default time-entry service updated.',
        }));
      }
    } catch (error) {
      handleError(error, t('general.timeEntryService.errors.save', {
        defaultValue: 'Failed to save default time-entry service',
      }));
    }
  };

  return (
    <div className="space-y-2">
      <CustomSelect
        id="default-time-entry-service"
        options={options}
        value={serviceId}
        onValueChange={handleChange}
        allowClear
        disabled={isLoading}
        placeholder={t('general.timeEntryService.placeholder', {
          defaultValue: 'No default service',
        })}
        label={t('general.timeEntryService.label', {
          defaultValue: 'Default time-entry service',
        })}
        className="!w-fit"
      />
      <p className="text-sm text-muted-foreground">
        {t('general.timeEntryService.help', {
          defaultValue:
            'Used for new ticket time entries when the client has no default of its own. The service must still be active and covered by the client contract.',
        })}
      </p>
    </div>
  );
};

export default DefaultTimeEntryServiceSettings;
